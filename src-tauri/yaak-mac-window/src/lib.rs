mod commands;

#[cfg(target_os = "macos")]
mod mac;

use crate::commands::{set_theme, set_title};
use tauri::{
    Runtime, generate_handler,
    plugin::{Builder, TauriPlugin},
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    #[allow(unused)]
    Builder::new("yaak-mac-window")
        .invoke_handler(generate_handler![set_title, set_theme])
        .on_window_ready(|window| {
            #[cfg(target_os = "macos")]
            {
                mac::setup_traffic_light_positioner(&window);
            }
        })
        .build()
}
