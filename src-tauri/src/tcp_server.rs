use base64::Engine;
use once_cell::sync::OnceCell;
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Emitter;

pub struct ServerHandle {
	stop_tx: mpsc::Sender<()>,
	thread_handle: Option<JoinHandle<()>>,
	clients: Arc<Mutex<HashMap<String, TcpStream>>>,
}

impl ServerHandle {
	pub fn stop(self) {
		let _ = self.stop_tx.send(());
		if let Some(h) = self.thread_handle {
			let _ = h.join();
		}
	}
}

static TCP_SERVER: OnceCell<Mutex<HashMap<String, ServerHandle>>> = OnceCell::new();

fn init_cell() {
	TCP_SERVER.get_or_init(|| Mutex::new(HashMap::new()));
}

pub fn start(app: AppHandle, bind_addr: String) -> Result<String, String> {
	init_cell();
	let cell = TCP_SERVER.get().unwrap();
	let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
	if guard.contains_key(&bind_addr) {
		return Err("TCP server already running for this address".into());
	}

	let listener = TcpListener::bind(&bind_addr).map_err(|e| format!("bind error: {}", e))?;
	listener
		.set_nonblocking(true)
		.map_err(|e| format!("set_nonblocking error: {}", e))?;

	let clients: Arc<Mutex<HashMap<String, TcpStream>>> = Arc::new(Mutex::new(HashMap::new()));
	let clients_thread = clients.clone();

	let (tx, rx) = mpsc::channel::<()>();
	let app_clone = app.clone();
	let addr = bind_addr.clone();

	let handle = thread::spawn(move || {
		let mut buf = [0u8; 65536];
		let mut seq: u64 = 0;

		loop {
			if rx.try_recv().is_ok() {
				break;
			}

			// accept new clients
			loop {
				match listener.accept() {
					Ok((stream, peer_addr)) => {
						let peer = peer_addr.to_string();
						let _ = stream.set_nonblocking(true);
						let _ = stream.set_nodelay(true);

						if let Ok(mut cg) = clients_thread.lock() {
							cg.insert(peer.clone(), stream);
						}

						let payload = json!({"bind": addr, "peer": peer});
						let _ = app_clone.emit("tcp:server:client_connected", payload);
					}
					Err(e) => match e.kind() {
						std::io::ErrorKind::WouldBlock => break,
						_ => {
							let payload = json!({"bind": addr, "error": format!("accept error: {}", e)});
							let _ = app_clone.emit("tcp:server:error", payload);
							break;
						}
					},
				}
			}

			// read from clients
			let peers: Vec<String> = match clients_thread.lock() {
				Ok(cg) => cg.keys().cloned().collect(),
				Err(_) => Vec::new(),
			};

			for peer in peers {
				let mut remove_peer = false;
				let mut data_opt: Option<Vec<u8>> = None;

				if let Ok(mut cg) = clients_thread.lock() {
					if let Some(stream) = cg.get_mut(&peer) {
						match stream.read(&mut buf) {
							Ok(0) => {
								remove_peer = true;
							}
							Ok(n) => {
								data_opt = Some(buf[..n].to_vec());
							}
							Err(e) => match e.kind() {
								std::io::ErrorKind::WouldBlock => {}
								_ => {
									remove_peer = true;
								}
							},
						}
					}
					if remove_peer {
						cg.remove(&peer);
					}
				}

				if let Some(data) = data_opt {
					seq = seq.wrapping_add(1);
					let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
					let ts_ms = SystemTime::now()
						.duration_since(UNIX_EPOCH)
						.map(|d| d.as_millis() as u64)
						.unwrap_or(0);
					let payload = json!({
						"bind": addr,
						"from": peer,
						"data": b64,
						"seq": seq,
						"ts_ms": ts_ms,
					});
					let _ = app_clone.emit("tcp:server:message", payload);
				} else if remove_peer {
					let payload = json!({"bind": addr, "peer": peer});
					let _ = app_clone.emit("tcp:server:client_disconnected", payload);
				}
			}

			thread::sleep(Duration::from_millis(10));
		}
	});

	guard.insert(
		bind_addr.clone(),
		ServerHandle {
			stop_tx: tx,
			thread_handle: Some(handle),
			clients,
		},
	);

	Ok(format!("TCP server started on {}", bind_addr))
}

pub fn stop(bind_addr: Option<String>) -> Result<String, String> {
	init_cell();
	let cell = TCP_SERVER.get().unwrap();
	let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
	if let Some(b) = bind_addr {
		if let Some(h) = guard.remove(&b) {
			h.stop();
			Ok(format!("TCP server stopped on {}", b))
		} else {
			Err("TCP server not running for that address".into())
		}
	} else {
		let previous = std::mem::take(&mut *guard);
		for (_k, h) in previous {
			h.stop();
		}
		Ok("All TCP servers stopped".into())
	}
}

pub fn send(bind_addr: String, to_peer: Option<String>, data_b64: String) -> Result<String, String> {
	let data = match base64::engine::general_purpose::STANDARD.decode(&data_b64) {
		Ok(d) => d,
		Err(e) => return Err(format!("base64 decode error: {}", e)),
	};

	init_cell();
	let cell = TCP_SERVER.get().unwrap();
	let guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
	let h = guard
		.get(&bind_addr)
		.ok_or_else(|| "TCP server not running for that address".to_string())?;

	let mut cg = h
		.clients
		.lock()
		.map_err(|e| format!("lock clients error: {}", e))?;

	let mut sent = 0usize;

	match to_peer {
		Some(peer) => {
			let stream = cg
				.get_mut(&peer)
				.ok_or_else(|| "peer not connected".to_string())?;
			stream
				.write_all(&data)
				.map_err(|e| format!("send error: {}", e))?;
			sent = 1;
			Ok(format!("sent {} bytes to {} ({} client)", data.len(), peer, sent))
		}
		None => {
			// broadcast
			let peers: Vec<String> = cg.keys().cloned().collect();
			for peer in peers {
				if let Some(stream) = cg.get_mut(&peer) {
					match stream.write_all(&data) {
						Ok(_) => sent += 1,
						Err(_) => {
							cg.remove(&peer);
						}
					}
				}
			}
			Ok(format!("broadcast {} bytes to {} client(s)", data.len(), sent))
		}
	}
}
