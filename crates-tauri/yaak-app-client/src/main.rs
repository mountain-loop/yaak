#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // On Nvidia + Wayland, WebKit2GTK's DMA-BUF renderer triggers a protocol error (71) due to
    // an explicit sync bug (https://bugs.webkit.org/show_bug.cgi?id=280210). Disabling explicit
    // sync via the Nvidia driver avoids the crash without disabling hardware acceleration.
    #[cfg(target_os = "linux")]
    if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err()
        && std::env::var("WAYLAND_DISPLAY").is_ok()
        && std::path::Path::new("/sys/module/nvidia").exists()
    {
        // SAFETY: called before any threads are spawned.
        unsafe { std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1") };
    }

    tauri_app_client_lib::run();
}
