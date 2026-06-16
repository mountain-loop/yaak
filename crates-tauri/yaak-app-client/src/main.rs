#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Prevents a Wayland protocol error (71) in WebKit2GTK's DMA-BUF renderer on some compositors.
    #[cfg(target_os = "linux")]
    if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        // SAFETY: called before any threads are spawned.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }

    tauri_app_client_lib::run();
}
