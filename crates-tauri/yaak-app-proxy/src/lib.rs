use log::{error, info, warn};
use tauri::Runtime;
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager, RunEvent, State, WebviewWindow};
use yaak_proxy_lib::{MasterKeySource, ProxyCtx};
use yaak_rpc::{RpcEventEmitter, RpcRouter};
use yaak_window::window::CreateWindowConfig;

mod window_menu;

fn setup_window_menu<R: Runtime>(win: &WebviewWindow<R>) {
    #[allow(unused_variables)]
    let menu = match window_menu::app_menu(win.app_handle()) {
        Ok(m) => m,
        Err(e) => {
            warn!("Failed to create menu: {e:?}");
            return;
        }
    };

    // This causes the window to not be clickable (in AppImage), so disable on Linux
    #[cfg(not(target_os = "linux"))]
    win.app_handle().set_menu(menu).expect("Failed to set app menu");

    handle_menu_events(win);
}

/// Carries out the app menu's items while `win` is focused. A window opened after the main one
/// takes the menu as it is, so the state its items are in, such as Go's, is kept.
fn handle_menu_events<R: Runtime>(win: &WebviewWindow<R>) {
    let webview_window = win.clone();
    win.on_menu_event(move |w, event| {
        if !w.is_focused().unwrap() {
            return;
        }

        let event_id = event.id().0.as_str();
        match event_id {
            "hacked_quit" => {
                w.webview_windows().iter().for_each(|(_, w)| {
                    info!("Closing window {}", w.label());
                    let _ = w.close();
                });
            }
            window_menu::EXPORT_HAR_ID => {
                if let Err(e) = webview_window.emit(window_menu::EXPORT_HAR_EVENT, ()) {
                    error!("Failed to emit the HAR export: {e}");
                }
            }
            window_menu::GO_BACK_ID | window_menu::GO_FORWARD_ID => {
                let event = if event_id == window_menu::GO_BACK_ID {
                    window_menu::GO_BACK_EVENT
                } else {
                    window_menu::GO_FORWARD_EVENT
                };
                if let Err(e) = webview_window.emit(event, ()) {
                    error!("Failed to emit {event}: {e}");
                }
            }
            "dev.refresh" => webview_window.eval("location.reload()").unwrap(),
            "dev.toggle_devtools" => {
                if webview_window.is_devtools_open() {
                    webview_window.close_devtools();
                } else {
                    webview_window.open_devtools();
                }
            }
            _ => {}
        }
    });
}

/// Where `tauri.bundle.conf.json` puts the `yaakprotoc` that Yaak's vendor script fetches, in
/// the app's resources.
const PROTOC_DIR: &str = "vendored/protoc";
/// Where it puts protoc's include files.
const PROTOC_INCLUDE_DIR: &str = "vendored/protoc/include";

/// The `yaakprotoc` and its includes in the app's resources, if the bundle has them, as a
/// packaged app's does; a development build has none.
fn bundled_protoc<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<yaak_proxy_lib::GrpcConfig> {
    let bin_name = if cfg!(windows) { "yaakprotoc.exe" } else { "yaakprotoc" };
    let resource = |path: &str| app.path().resolve(path, BaseDirectory::Resource).ok();
    let protoc_bin_path = resource(&format!("{PROTOC_DIR}/{bin_name}"))?;
    let protoc_include_dir = resource(PROTOC_INCLUDE_DIR)?;
    protoc_bin_path
        .is_file()
        .then_some(yaak_proxy_lib::GrpcConfig { protoc_include_dir, protoc_bin_path })
}

/// The main window's label.
const MAIN_WINDOW_LABEL: &str = "main_0";
/// The name the Settings window is opened under, and the key its size and position are kept by.
const SETTINGS_WINDOW_NAME: &str = "settings";
/// The Settings window's label, by which its page renders the settings alone: its name with the
/// prefix the shared code gives each child window, as Yaak's Settings window has.
const SETTINGS_WINDOW_LABEL: &str = "other__settings";
/// The event that moves an open Settings window to another tab.
const SETTINGS_TAB_EVENT: &str = "settings_tab";
/// The Settings window's size, as Yaak's.
const SETTINGS_WINDOW_SIZE: (f64, f64) = (750.0, 600.0);
/// The smallest the Settings window goes, still showing the tabs beside their content.
const SETTINGS_WINDOW_MIN_SIZE: (f64, f64) = (600.0, 450.0);

/// Sets the tab a new Settings window opens on, before its page loads, so it needs no URL.
fn settings_tab_script(tab: &str) -> String {
    let tab = serde_json::to_string(tab).unwrap_or_else(|_| "null".to_string());
    format!("window.__YAAK_SETTINGS_TAB__ = {tab};")
}

/// Opens Settings on `tab` in a child of the main window, or, when it is open, brings it forward
/// and moves it to `tab` if one is given. As Yaak's, the child sits over the middle of the main
/// window the first time and where it was left after; it stays in front, taking focus back when
/// the main window is clicked, and closes with it.
#[tauri::command]
async fn cmd_open_settings(
    app_handle: tauri::AppHandle,
    tab: Option<String>,
) -> Result<(), String> {
    if let Some(win) = app_handle.get_webview_window(SETTINGS_WINDOW_LABEL) {
        if win.is_minimized().unwrap_or(false) {
            win.unminimize().map_err(|e| e.to_string())?;
        }
        win.set_focus().map_err(|e| e.to_string())?;
        if let Some(tab) = tab {
            win.emit_to(SETTINGS_WINDOW_LABEL, SETTINGS_TAB_EVENT, tab)
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    let main = app_handle
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("The main window is not open to open Settings over")?;
    let win = yaak_window::window::create_child_window(
        &main,
        "/",
        SETTINGS_WINDOW_NAME,
        "Yaak Proxy Settings",
        SETTINGS_WINDOW_SIZE,
        tab.as_deref().map(settings_tab_script),
        false,
    )
    .map_err(|e| e.to_string())?;
    let (width, height) = SETTINGS_WINDOW_MIN_SIZE;
    win.set_min_size(Some(tauri::LogicalSize::new(width, height))).map_err(|e| e.to_string())?;
    handle_menu_events(&win);
    Ok(())
}

#[tauri::command]
async fn rpc(
    router: State<'_, RpcRouter<ProxyCtx>>,
    ctx: State<'_, ProxyCtx>,
    cmd: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    router.dispatch(&cmd, payload, &ctx).await.map_err(|e| e.message)
}

/// Go's Back and Forward, enabled as the window has somewhere to go.
#[tauri::command]
fn set_go_menu(app: tauri::AppHandle, back: bool, forward: bool) {
    window_menu::set_go_enabled(&app, back, forward);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(yaak_mac_window::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");

            let (emitter, event_rx) = RpcEventEmitter::new();
            // Captured traffic is encrypted with a key wrapped by a master key in the keychain,
            // under this app's identifier, so a development build keeps its own. Linux without
            // a Secret Service keeps it in a file only the user can read, with a warning.
            let keys = MasterKeySource::keychain_or_file(
                &app.config().identifier,
                data_dir.join("encryption.key"),
            );
            let mut ctx = ProxyCtx::new(&data_dir, emitter, keys)?;
            // Compiles protos attached for gRPC decoding when the bundle has protoc, as Yaak's
            // does; otherwise one on PATH is used.
            if let Some(config) = bundled_protoc(app.handle()) {
                ctx = ctx.with_protoc(config);
            }
            // Not while the CLI daemon owns the engine: the window offers to take it over.
            match ctx.serve_control_api() {
                // The engine runs for as long as the app does. A failure, such as the port
                // being taken, is kept for the window to show.
                Ok(()) => {
                    let ctx = ctx.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = ctx.start() {
                            warn!("Failed to start the proxy: {e}");
                        }
                    });
                }
                Err(e) => warn!("Not serving the proxy control API: {e}"),
            }
            app.manage(ctx);
            app.manage(yaak_proxy_lib::build_router());

            // Drain RPC events and forward as Tauri events
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for event in event_rx {
                    if let Err(e) = app_handle.emit(event.event, event.payload) {
                        error!("Failed to emit RPC event: {e}");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc, set_go_menu, cmd_open_settings])
        .build(tauri::generate_context!())
        .expect("error while building yaak proxy tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                // Never leave the Mac pointed at a proxy that is gone.
                let ctx = app_handle.state::<ProxyCtx>();
                ctx.shutdown();
                ctx.stop_control_api();
                return;
            }
            if let RunEvent::Ready = event {
                let config = CreateWindowConfig {
                    url: "/",
                    label: MAIN_WINDOW_LABEL,
                    title: "Yaak Proxy",
                    inner_size: Some((1000.0, 700.0)),
                    hidden: true,
                    hide_titlebar: true,
                    ..Default::default()
                };
                match yaak_window::window::create_window(app_handle, config) {
                    Ok(win) => setup_window_menu(&win),
                    Err(e) => error!("Failed to create proxy window: {e:?}"),
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bundle puts protoc, and its includes, where the app looks for them.
    #[test]
    fn the_bundle_ships_protoc_where_the_app_looks() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.bundle.conf.json")).unwrap();
        let resources = config["bundle"]["resources"].as_object().unwrap();
        let target = |source: &str| resources.get(source).and_then(|t| t.as_str());
        assert_eq!(
            target("../yaak-app-client/vendored/protoc/yaakprotoc*")
                .map(|t| t.trim_end_matches('/')),
            Some(PROTOC_DIR)
        );
        assert_eq!(target("../yaak-app-client/vendored/protoc/include"), Some(PROTOC_INCLUDE_DIR));
    }

    /// The window may call each opener command the app's settings use: without its permission,
    /// Tauri refuses the call and the button does nothing.
    #[test]
    fn the_window_may_open_links_and_reveal_folders() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let permissions: Vec<&str> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        for needed in ["opener:allow-open-url", "opener:allow-reveal-item-in-dir"] {
            assert!(permissions.contains(&needed), "{needed} missing from {permissions:?}");
        }
    }

    /// The Settings window gets the main window's permissions: without them its links, folders,
    /// Escape closing it and the events that keep both windows in step would all be refused.
    #[test]
    fn the_settings_window_has_the_main_windows_permissions() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let windows: Vec<&str> =
            capability["windows"].as_array().unwrap().iter().filter_map(|w| w.as_str()).collect();
        for label in [MAIN_WINDOW_LABEL, SETTINGS_WINDOW_LABEL] {
            assert!(
                windows.contains(&"*") || windows.contains(&label),
                "{label} missing from {windows:?}"
            );
        }
        let permissions: Vec<&str> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        for needed in ["core:default", "core:window:allow-close"] {
            assert!(permissions.contains(&needed), "{needed} missing from {permissions:?}");
        }
    }

    /// The page knows the Settings window by the label the shared code gives a child window
    /// opened under its name, or it would render the whole app in it.
    #[test]
    fn the_page_knows_the_settings_window_by_its_label() {
        assert_eq!(SETTINGS_WINDOW_LABEL, format!("other__{SETTINGS_WINDOW_NAME}"));
        let windows = include_str!("../../../apps/yaak-proxy/lib/windows.ts");
        assert!(
            windows.contains(&format!("SETTINGS_WINDOW_LABEL = \"{SETTINGS_WINDOW_LABEL}\"")),
            "the page's Settings window label is not {SETTINGS_WINDOW_LABEL}"
        );
    }

    /// The tab reaches the new window's page as a string literal, whatever it holds.
    #[test]
    fn the_settings_tab_script_quotes_the_tab() {
        assert_eq!(settings_tab_script("proxy"), r#"window.__YAAK_SETTINGS_TAB__ = "proxy";"#);
        assert_eq!(
            settings_tab_script(r#"a";alert(1);""#),
            r#"window.__YAAK_SETTINGS_TAB__ = "a\";alert(1);\"";"#
        );
    }
}
