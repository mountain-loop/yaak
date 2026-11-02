#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Says what macOS reports about the privileged helper, without opening a window.
    if std::env::args().any(|a| a == "--helper-status") {
        println!("{}", yaak_proxy_lib::helper::diagnose());
        return;
    }
    tauri_app_proxy_lib::run();
}
