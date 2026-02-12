// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod tcp_client;
mod tcp_server;
mod udp_client;
mod udp_server;

#[tauri::command]
fn start_udp_server(app: tauri::AppHandle, bind_addr: String) -> Result<String, String> {
    udp_server::start(app, bind_addr)
}

#[tauri::command]
fn udp_send(to_addr: String, data_b64: String) -> Result<String, String> {
    udp_server::send_to(to_addr, data_b64)
}

#[tauri::command]
fn udp_send_from(bind_addr: String, to_addr: String, data_b64: String) -> Result<String, String> {
    udp_server::send_from(bind_addr, to_addr, data_b64)
}

#[tauri::command]
fn stop_udp_server(bind_addr: Option<String>) -> Result<String, String> {
    udp_server::stop(bind_addr)
}

#[tauri::command]
fn start_udp_client(app: tauri::AppHandle, bind_addr: String) -> Result<String, String> {
    udp_client::start(app, bind_addr)
}

#[tauri::command]
fn stop_udp_client(bind_addr: Option<String>) -> Result<String, String> {
    udp_client::stop(bind_addr)
}

#[tauri::command]
fn udp_client_send_from(
    bind_addr: String,
    to_addr: String,
    data_b64: String,
) -> Result<String, String> {
    udp_client::send_from(bind_addr, to_addr, data_b64)
}

#[tauri::command]
fn start_tcp_server(app: tauri::AppHandle, bind_addr: String) -> Result<String, String> {
    tcp_server::start(app, bind_addr)
}

#[tauri::command]
fn stop_tcp_server(bind_addr: Option<String>) -> Result<String, String> {
    tcp_server::stop(bind_addr)
}

#[tauri::command]
fn tcp_server_send(
    bind_addr: String,
    to_peer: Option<String>,
    data_b64: String,
) -> Result<String, String> {
    tcp_server::send(bind_addr, to_peer, data_b64)
}

#[tauri::command]
fn start_tcp_client(app: tauri::AppHandle, remote_addr: String) -> Result<String, String> {
    tcp_client::start(app, remote_addr)
}

#[tauri::command]
fn stop_tcp_client(remote_addr: Option<String>) -> Result<String, String> {
    tcp_client::stop(remote_addr)
}

#[tauri::command]
fn tcp_client_send(remote_addr: String, data_b64: String) -> Result<String, String> {
    tcp_client::send(remote_addr, data_b64)
}

#[tauri::command]
fn list_local_ips() -> Result<Vec<String>, String> {
    match if_addrs::get_if_addrs() {
        Ok(addrs) => {
            let mut ips: Vec<String> = addrs
                .into_iter()
                .filter_map(|iface| match iface.ip() {
                    std::net::IpAddr::V4(v4) => {
                        if v4.is_loopback() {
                            None
                        } else {
                            Some(v4.to_string())
                        }
                    }
                    _ => None,
                })
                .collect();
            ips.sort();
            ips.dedup();
            Ok(ips)
        }
        Err(e) => Err(format!("{}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_udp_server,
            stop_udp_server,
            udp_send,
            udp_send_from,
            start_udp_client,
            stop_udp_client,
            udp_client_send_from,
            start_tcp_server,
            stop_tcp_server,
            tcp_server_send,
            start_tcp_client,
            stop_tcp_client,
            tcp_client_send,
            list_local_ips
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
