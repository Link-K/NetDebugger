use base64::Engine;
use once_cell::sync::OnceCell;
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{mpsc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Emitter;

pub struct ClientHandle {
	stop_tx: mpsc::Sender<()>,
	thread_handle: Option<JoinHandle<()>>,
	stream: TcpStream,
}

impl ClientHandle {
	pub fn stop(self) {
		let _ = self.stop_tx.send(());
		if let Some(h) = self.thread_handle {
			let _ = h.join();
		}
	}
}

static TCP_CLIENT: OnceCell<Mutex<HashMap<String, ClientHandle>>> = OnceCell::new();

fn init_cell() {
	TCP_CLIENT.get_or_init(|| Mutex::new(HashMap::new()));
}

pub fn start(app: AppHandle, remote_addr: String) -> Result<String, String> {
	init_cell();
	let cell = TCP_CLIENT.get().unwrap();
	let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
	if guard.contains_key(&remote_addr) {
		return Err("TCP client already connected to this address".into());
	}

	let stream = TcpStream::connect(&remote_addr).map_err(|e| format!("connect error: {}", e))?;
	let _ = stream.set_nodelay(true);
	let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));

	let mut read_stream = stream
		.try_clone()
		.map_err(|e| format!("stream clone error: {}", e))?;
	let _ = read_stream.set_read_timeout(Some(Duration::from_millis(100)));

	let (tx, rx) = mpsc::channel::<()>();
	let app_clone = app.clone();
	let addr = remote_addr.clone();

	let handle = thread::spawn(move || {
		let mut buf = [0u8; 65536];
		let mut seq: u64 = 0;
		loop {
			if rx.try_recv().is_ok() {
				break;
			}
			match read_stream.read(&mut buf) {
				Ok(0) => {
					let payload = json!({"remote": addr, "error": "connection closed"});
					let _ = app_clone.emit("tcp:client:error", payload);
					break;
				}
				Ok(n) => {
					seq = seq.wrapping_add(1);
					let b64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
					let ts_ms = SystemTime::now()
						.duration_since(UNIX_EPOCH)
						.map(|d| d.as_millis() as u64)
						.unwrap_or(0);
					let payload = json!({
						"remote": addr,
						"data": b64,
						"seq": seq,
						"ts_ms": ts_ms,
					});
					let _ = app_clone.emit("tcp:client:message", payload);
				}
				Err(e) => match e.kind() {
					std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => {}
					_ => {
						let payload = json!({"remote": addr, "error": format!("read error: {}", e)});
						let _ = app_clone.emit("tcp:client:error", payload);
						break;
					}
				},
			}
		}
	});

	guard.insert(
		remote_addr.clone(),
		ClientHandle {
			stop_tx: tx,
			thread_handle: Some(handle),
			stream,
		},
	);

	Ok(format!("TCP client connected to {}", remote_addr))
}

pub fn stop(remote_addr: Option<String>) -> Result<String, String> {
	init_cell();
	let cell = TCP_CLIENT.get().unwrap();
	let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
	if let Some(a) = remote_addr {
		if let Some(h) = guard.remove(&a) {
			h.stop();
			Ok(format!("TCP client disconnected from {}", a))
		} else {
			Err("TCP client not connected to that address".into())
		}
	} else {
		let previous = std::mem::take(&mut *guard);
		for (_k, h) in previous {
			h.stop();
		}
		Ok("All TCP clients disconnected".into())
	}
}

pub fn send(remote_addr: String, data_b64: String) -> Result<String, String> {
	let data = match base64::engine::general_purpose::STANDARD.decode(&data_b64) {
		Ok(d) => d,
		Err(e) => return Err(format!("base64 decode error: {}", e)),
	};

	init_cell();
	let cell = TCP_CLIENT.get().unwrap();
	let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
	let h = guard
		.get_mut(&remote_addr)
		.ok_or_else(|| "TCP client not connected to that address".to_string())?;

	h.stream
		.write_all(&data)
		.map_err(|e| format!("send error: {}", e))?;

	Ok(format!("sent {} bytes to {}", data.len(), remote_addr))
}
