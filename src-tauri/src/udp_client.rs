use base64::Engine;
use once_cell::sync::OnceCell;
use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::net::UdpSocket;
use std::sync::{mpsc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Emitter;

pub struct ClientHandle {
    stop_tx: mpsc::Sender<()>,
    thread_handle: Option<JoinHandle<()>>,
    send_sock: UdpSocket,
}

impl ClientHandle {
    pub fn stop(self) {
        let _ = self.stop_tx.send(());
        if let Some(h) = self.thread_handle {
            let _ = h.join();
        }
    }
}

static UDP_CLIENT: OnceCell<Mutex<HashMap<String, ClientHandle>>> = OnceCell::new();

fn init_cell() {
    UDP_CLIENT.get_or_init(|| Mutex::new(HashMap::new()));
}

pub fn start(app: AppHandle, bind_addr: String) -> Result<String, String> {
    init_cell();
    let cell = UDP_CLIENT.get().unwrap();
    let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
    if guard.contains_key(&bind_addr) {
        return Err("UDP client already running for this address".into());
    }

    let sock = UdpSocket::bind(&bind_addr).map_err(|e| format!("bind error: {}", e))?;
    let _ = sock.set_read_timeout(Some(Duration::from_millis(100)));
    let send_sock = sock
        .try_clone()
        .map_err(|e| format!("socket clone error: {}", e))?;

    let (tx, rx) = mpsc::channel::<()>();
    let app_clone = app.clone();
    let addr = bind_addr.clone();

    let handle = thread::spawn(move || {
        let sock = sock;
        let mut buf = [0u8; 65536];
        let mut seq: u64 = 0;
        let mut last: Option<(u64, Instant)> = None;

        loop {
            if rx.try_recv().is_ok() {
                break;
            }
            match sock.recv_from(&mut buf) {
                Ok((n, src)) => {
                    seq = seq.wrapping_add(1);
                    let data = &buf[..n];

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
                        "bind": addr,
                        "from": src.to_string(),
                        "data": b64,
                        "seq": seq,
                        "ts_ms": ts_ms,
                        "dup": dup,
                    });
                    println!("[udp-client:{}] recv {} bytes from {}", addr, n, src);
                    let _ = app_clone.emit("udp:client:message", payload);
                }
                Err(e) => match e.kind() {
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => {}
                    _ => {
                        let payload = json!({"error": format!("recv error: {}", e), "bind": addr});
                        let _ = app_clone.emit("udp:client:error", payload);
                    }
                },
            }
        }
    });

    guard.insert(
        bind_addr.clone(),
        ClientHandle {
            stop_tx: tx,
            thread_handle: Some(handle),
            send_sock,
        },
    );

    Ok(format!("UDP client started on {}", bind_addr))
}

pub fn stop(bind_addr: Option<String>) -> Result<String, String> {
    init_cell();
    let cell = UDP_CLIENT.get().unwrap();
    let mut guard = cell.lock().map_err(|e| format!("lock error: {}", e))?;
    if let Some(b) = bind_addr {
        if let Some(h) = guard.remove(&b) {
            h.stop();
            Ok(format!("UDP client stopped on {}", b))
        } else {
            Err("UDP client not running for that address".into())
        }
    } else {
        let previous = std::mem::take(&mut *guard);
        for (_k, h) in previous {
            h.stop();
        }
        Ok("All UDP clients stopped".into())
    }
}

pub fn send_from(bind_addr: String, to_addr: String, data_b64: String) -> Result<String, String> {
    let data = match base64::engine::general_purpose::STANDARD.decode(&data_b64) {
        Ok(d) => d,
        Err(e) => return Err(format!("base64 decode error: {}", e)),
    };

    init_cell();
    let cell = UDP_CLIENT.get().unwrap();

    if let Ok(guard) = cell.lock() {
        if let Some(h) = guard.get(&bind_addr) {
            return match h.send_sock.send_to(&data, &to_addr) {
                Ok(n) => Ok(format!(
                    "sent {} bytes to {} from {}",
                    n, to_addr, bind_addr
                )),
                Err(e) => Err(format!("send error: {}", e)),
            };
        }
    }

    let sock = UdpSocket::bind(&bind_addr).map_err(|e| format!("bind error: {}", e))?;
    match sock.send_to(&data, &to_addr) {
        Ok(n) => Ok(format!(
            "sent {} bytes to {} from {}",
            n, to_addr, bind_addr
        )),
        Err(e) => Err(format!("send error: {}", e)),
    }
}
