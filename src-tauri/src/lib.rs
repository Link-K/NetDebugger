// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
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
fn stop_udp_server() -> Result<String, String> {
    udp_server::stop()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_udp_server,
            stop_udp_server,
            udp_send
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
