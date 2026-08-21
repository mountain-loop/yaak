use std::sync::{Arc, Mutex};
#[cfg(target_os = "linux")]
use std::time::Duration;

#[cfg(any(target_os = "linux", target_os = "macos"))]
use log::{debug, warn};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use tauri::Emitter;
use tauri::{AppHandle, Runtime};

pub const INITIAL_APPEARANCE_GLOBAL: &str = "__YAAK_INITIAL_APPEARANCE__";
pub const SYSTEM_APPEARANCE_CHANGE_EVENT: &str = "system_appearance_change";

#[cfg(target_os = "linux")]
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

#[derive(Clone)]
pub struct SystemAppearanceState {
    last_appearance: Arc<Mutex<Option<Appearance>>>,
}

impl SystemAppearanceState {
    pub fn last_appearance(&self) -> Option<Appearance> {
        *self.last_appearance.lock().expect("system appearance lock poisoned")
    }
}

pub fn initialization_script(appearance: Appearance) -> String {
    let appearance = appearance.as_str();
    format!("window.{INITIAL_APPEARANCE_GLOBAL} = {appearance:?};")
}

/// Detect the appearance the OS prefers, independent of any appearance that has
/// been forced onto app windows (which is what the webview itself reports).
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
            debug!("Failed to detect system appearance: {err:?}");
            None
        }
    }
}

/// Detect the appearance the OS prefers, independent of any appearance that has
/// been forced onto app windows (which is what the webview itself reports).
///
/// This asks AppKit for the application's effective appearance, the same source tauri
/// uses for `window.theme()`, instead of reading `AppleInterfaceStyle` from the user
/// defaults: macOS 27 no longer reliably writes that key when dark mode is on, so anything
/// reading it sees light mode. Appearances forced per window (yaak-mac-window) don't reach
/// `NSApp`, so this is the OS preference.
#[cfg(target_os = "macos")]
pub fn system_appearance() -> Option<Appearance> {
    use objc2_app_kit::{NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication};
    use objc2_foundation::NSArray;

    // AppKit is main-thread only. Every caller runs there today; this keeps it correct if
    // one ever doesn't.
    dispatch2::run_on_main(|mtm| {
        let app = NSApplication::sharedApplication(mtm);

        // An appearance forced on the whole app (tauri's `set_theme` does this) would make
        // the effective appearance report the override instead of the OS preference. Nothing
        // in Yaak does that, but fall back to the user defaults if something ever does.
        //
        // SAFETY: Called on the main thread with the shared application
        if unsafe { app.appearance() }.is_some() {
            return defaults_appearance();
        }

        // SAFETY: The appearance names are AppKit constants that live for the whole process
        let (dark, light) = unsafe { (NSAppearanceNameDarkAqua, NSAppearanceNameAqua) };
        let names = NSArray::from_slice(&[dark, light]);
        let best = app.effectiveAppearance().bestMatchFromAppearancesWithNames(&names)?;

        // SAFETY: Both are valid strings
        let is_dark = unsafe { best.isEqualToString(dark) };
        Some(if is_dark { Appearance::Dark } else { Appearance::Light })
    })
}

/// The appearance macOS persists to the global user defaults. Absent means light, except
/// on macOS 27, which stopped reliably writing the key. Only used when the effective
/// appearance is forced and can't be trusted.
#[cfg(target_os = "macos")]
fn defaults_appearance() -> Option<Appearance> {
    use objc2_foundation::{NSUserDefaults, ns_string};

    // SAFETY: The standard defaults are a process-wide singleton and the key is a valid string
    let style = unsafe {
        NSUserDefaults::standardUserDefaults().stringForKey(ns_string!("AppleInterfaceStyle"))
    };

    // SAFETY: Both are valid strings
    let is_dark = style.is_some_and(|style| unsafe { style.isEqualToString(ns_string!("Dark")) });
    Some(if is_dark { Appearance::Dark } else { Appearance::Light })
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn system_appearance() -> Option<Appearance> {
    None
}

/// Start tracking the OS appearance. Linux polls for changes. macOS gets them from tauri's
/// `WindowEvent::ThemeChanged` (tao observes `AppleInterfaceThemeChangedNotification`), which
/// the app forwards to [`emit_change`], so no thread is needed there.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn watch<R: Runtime>(app_handle: AppHandle<R>) -> Option<SystemAppearanceState> {
    let last_appearance = system_appearance();
    if last_appearance.is_none() {
        debug!("System appearance detection unavailable");
        return None;
    }

    let state = SystemAppearanceState { last_appearance: Arc::new(Mutex::new(last_appearance)) };

    #[cfg(target_os = "linux")]
    {
        let thread_state = state.clone();
        let _ = std::thread::spawn(move || {
            loop {
                std::thread::sleep(SYSTEM_APPEARANCE_POLL_INTERVAL);
                emit_change(&app_handle, &thread_state);
            }
        });
    }
    #[cfg(target_os = "macos")]
    let _ = app_handle;

    Some(state)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn watch<R: Runtime>(_app_handle: AppHandle<R>) -> Option<SystemAppearanceState> {
    None
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
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
