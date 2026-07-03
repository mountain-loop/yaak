use std::sync::{Arc, Mutex};
use std::time::Duration;

use log::{debug, warn};
use tauri::{AppHandle, Emitter, Runtime};

pub const INITIAL_APPEARANCE_GLOBAL: &str = "__YAAK_INITIAL_APPEARANCE__";
pub const INITIAL_APPEARANCE_SOURCE_GLOBAL: &str = "__YAAK_INITIAL_APPEARANCE_SOURCE__";
pub const SYSTEM_APPEARANCE_CHANGE_EVENT: &str = "system_appearance_change";

const SYSTEM_APPEARANCE_POLL_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Appearance {
    Dark,
    Light,
}

impl Appearance {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dark => "dark",
            Self::Light => "light",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InitialAppearanceSource {
    Settings,
    LinuxSystem,
}

impl InitialAppearanceSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Settings => "settings",
            Self::LinuxSystem => "linux-system",
        }
    }
}

#[derive(Clone)]
pub struct SystemAppearanceState {
    last_appearance: Arc<Mutex<Option<Appearance>>>,
}

pub fn initialization_script(appearance: Appearance, source: InitialAppearanceSource) -> String {
    let appearance = appearance.as_str();
    let source = source.as_str();
    format!(
        "window.{INITIAL_APPEARANCE_GLOBAL} = {appearance:?};\
        window.{INITIAL_APPEARANCE_SOURCE_GLOBAL} = {source:?};"
    )
}

#[cfg(target_os = "linux")]
pub fn system_appearance() -> Option<Appearance> {
    if let Some(appearance) = gsettings_system_appearance() {
        return Some(appearance);
    }

    match dark_light::detect() {
        Ok(dark_light::Mode::Dark) => Some(Appearance::Dark),
        Ok(dark_light::Mode::Light) => Some(Appearance::Light),
        Ok(dark_light::Mode::Unspecified) => None,
        Err(err) => {
            debug!("Failed to detect Linux system appearance: {err:?}");
            None
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn system_appearance() -> Option<Appearance> {
    None
}

#[cfg(target_os = "linux")]
pub fn watch<R: Runtime>(app_handle: AppHandle<R>) -> Option<SystemAppearanceState> {
    let last_appearance = system_appearance();
    if last_appearance.is_none() {
        debug!("Linux system appearance detection unavailable");
        return None;
    }

    let state = SystemAppearanceState { last_appearance: Arc::new(Mutex::new(last_appearance)) };
    let thread_state = state.clone();
    let _ = std::thread::spawn(move || {
        loop {
            std::thread::sleep(SYSTEM_APPEARANCE_POLL_INTERVAL);
            emit_change(&app_handle, &thread_state);
        }
    });

    Some(state)
}

#[cfg(not(target_os = "linux"))]
pub fn watch<R: Runtime>(_app_handle: AppHandle<R>) -> Option<SystemAppearanceState> {
    None
}

#[cfg(target_os = "linux")]
pub fn emit_change<R: Runtime>(app_handle: &AppHandle<R>, state: &SystemAppearanceState) {
    let appearance = system_appearance();
    let mut last_appearance =
        state.last_appearance.lock().expect("system appearance lock poisoned");
    if appearance == *last_appearance {
        return;
    }

    *last_appearance = appearance;
    if let Some(appearance) = appearance {
        let appearance = appearance.as_str();
        debug!("System appearance changed to {appearance}");
        if let Err(err) = app_handle.emit(SYSTEM_APPEARANCE_CHANGE_EVENT, appearance) {
            warn!("Failed to emit system appearance change: {err:?}");
        }
    }
}

#[cfg(target_os = "linux")]
fn gsettings_system_appearance() -> Option<Appearance> {
    let color_scheme = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "color-scheme"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .unwrap_or_default();

    if color_scheme.contains("prefer-dark") {
        return Some(Appearance::Dark);
    }
    if color_scheme.contains("prefer-light") {
        return Some(Appearance::Light);
    }

    let gtk_theme = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "gtk-theme"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .unwrap_or_default();

    if gtk_theme.to_lowercase().contains("dark") {
        return Some(Appearance::Dark);
    }

    (!gtk_theme.trim().is_empty()).then_some(Appearance::Light)
}
