mod commands;

#[cfg(target_os = "macos")]
mod mac;

use crate::commands::{set_theme, set_title};
use std::sync::atomic::AtomicBool;
use tauri::{Manager, Runtime, generate_handler, plugin, plugin::TauriPlugin};

pub trait AppHandleMacWindowExt {
    /// Sets whether to use the native titlebar
    fn set_native_titlebar(&self, enable: bool);
}

impl<R: Runtime> AppHandleMacWindowExt for tauri::AppHandle<R> {
    fn set_native_titlebar(&self, enable: bool) {
        self.state::<PluginState>()
            .native_titlebar
            .store(enable, std::sync::atomic::Ordering::Relaxed);
    }
}

pub(crate) struct PluginState {
    native_titlebar: AtomicBool,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let mut builder = plugin::Builder::new("yaak-mac-window")
        .setup(move |app, _| {
            app.manage(PluginState { native_titlebar: AtomicBool::new(false) });
            Ok(())
        })
        .invoke_handler(generate_handler![set_title, set_theme]);

    #[cfg(target_os = "macos")]
    {
        builder = builder.on_window_ready(move |window| {
            mac::setup_traffic_light_positioner(&window);
        });
    }

    builder.build()
}
