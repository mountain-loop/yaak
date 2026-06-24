use log::{error, info, warn};
use tauri::Runtime;
use tauri::{Emitter, Manager, RunEvent, State, WebviewWindow};
use yaak_proxy_lib::ProxyCtx;
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

#[tauri::command]
fn rpc(
    router: State<'_, RpcRouter<ProxyCtx>>,
    ctx: State<'_, ProxyCtx>,
    cmd: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    router.dispatch(&cmd, payload, &ctx).map_err(|e| e.message)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(yaak_mac_window::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");

            let (emitter, event_rx) = RpcEventEmitter::new();
            app.manage(ProxyCtx::new(&data_dir.join("proxy.db"), emitter));
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
        .invoke_handler(tauri::generate_handler![rpc])
        .build(tauri::generate_context!())
        .expect("error while building yaak proxy tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Ready = event {
                let config = CreateWindowConfig {
                    url: "/",
                    label: "main_0",
                    title: "Yaak Proxy",
                    inner_size: Some((1000.0, 700.0)),
                    visible: false,
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
