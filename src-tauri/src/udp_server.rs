use base64::Engine;
use once_cell::sync::OnceCell;
use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::net::UdpSocket;
use std::sync::{mpsc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
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

    let handle = thread::spawn(move || {
        let sock = match UdpSocket::bind(&addr) {
            Ok(s) => s,
            Err(e) => {
                let payload = json!({"error": format!("bind error: {}", e)});
                let _ = app_clone.emit("udp:server:error", payload);
                return;
            }
        };

        // Allow graceful shutdown: recv_from must not block forever or stop() will hang.
        let _ = sock.set_read_timeout(Some(Duration::from_millis(100)));

        let mut buf = [0u8; 65536];
        let mut seq: u64 = 0;
        let mut last: Option<(u64, Instant)> = None;
        loop {
            if let Ok(_) = rx.try_recv() {
                break;
            }
            match sock.recv_from(&mut buf) {
                Ok((n, src)) => {
                    seq = seq.wrapping_add(1);
                    let data = &buf[..n];

                    // detect (but do not suppress) likely duplicate packets in a short window
                    let mut hasher = DefaultHasher::new();
                    src.to_string().hash(&mut hasher);
                    n.hash(&mut hasher);
                    data.hash(&mut hasher);
                    let hash = hasher.finish();

                    let now = Instant::now();
                    let dup = last
                        .map(|(h, t)| {
                            h == hash && now.duration_since(t) < Duration::from_millis(50)
                        })
                        .unwrap_or(false);
                    last = Some((hash, now));

                    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
                    let ts_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let payload = json!({
                        "from": src.to_string(),
                        "data": b64,
                        "seq": seq,
                        "ts_ms": ts_ms,
                        "dup": dup,
                    });
                    println!("[udp] recv {} bytes from {}", n, src);
                    let _ = app_clone.emit("udp:message", payload);
                }
                Err(e) => {
                    // expected when read_timeout triggers
                    match e.kind() {
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => {}
                        _ => {
                            let payload = json!({"error": format!("recv error: {}", e)});
                            let _ = app_clone.emit("udp:server:error", payload);
                        }
                    }
                }
            }
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
