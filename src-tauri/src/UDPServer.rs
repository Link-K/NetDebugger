use base64::Engine;
use once_cell::sync::OnceCell;
use serde_json::json;
use std::net::UdpSocket;
use std::sync::{mpsc, Mutex};
use std::thread::{self, JoinHandle};
use tauri::AppHandle;
use tauri::Emitter;

pub struct ServerHandle {
    stop_tx: mpsc::Sender<()>,
    thread_handle: Option<JoinHandle<()>>,
}

impl ServerHandle {
    pub fn stop(self) {
        let _ = self.stop_tx.send(());
        if let Some(h) = self.thread_handle {
            let _ = h.join();
        }
    }
}

static UDP_SERVER: OnceCell<Mutex<Option<ServerHandle>>> = OnceCell::new();

fn init_cell() {
    UDP_SERVER.get_or_init(|| Mutex::new(None));
}

pub fn start(app: AppHandle, bind_addr: String) -> Result<String, String> {
    init_cell();
    let cell = UDP_SERVER.get().unwrap();
    let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
    if guard.is_some() {
        return Err("UDP server already running".into());
    }

    let (tx, rx) = mpsc::channel::<()>();
    let app_clone = app.clone();
    let addr = bind_addr.clone();

    let handle = thread::spawn(move || match UdpSocket::bind(&addr) {
        Ok(sock) => {
            let mut buf = [0u8; 65536];
            loop {
                if let Ok(_) = rx.try_recv() {
                    break;
                }
                match sock.recv_from(&mut buf) {
                    Ok((n, src)) => {
                        let data = &buf[..n];
                        let payload = json!({
                            "from": src.to_string(),
                            "data": base64::engine::general_purpose::STANDARD.encode(data),
                        });
                        let _ = app_clone.emit("udp:message", payload);
                    }
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
            }
        }
        Err(e) => {
            let payload = json!({"error": format!("bind error: {}", e)});
            let _ = app_clone.emit("udp:server:error", payload);
        }
    });

    *guard = Some(ServerHandle {
        stop_tx: tx,
        thread_handle: Some(handle),
    });

    Ok(format!("UDP server started on {}", bind_addr))
}

pub fn stop() -> Result<String, String> {
    init_cell();
    let cell = UDP_SERVER.get().unwrap();
    let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
    if let Some(h) = guard.take() {
        h.stop();
        Ok("UDP server stopped".into())
    } else {
        Err("UDP server not running".into())
    }
}
