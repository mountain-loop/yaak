use log::{error, info, warn};
use tauri::Runtime;
use tauri::path::BaseDirectory;
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

/// The `yaakprotoc` and its includes in the app's resources, if the bundle has them.
fn bundled_protoc<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<yaak_proxy_lib::GrpcConfig> {
    let bin_name = if cfg!(windows) { "yaakprotoc.exe" } else { "yaakprotoc" };
    let resource = |path: &str| app.path().resolve(path, BaseDirectory::Resource).ok();
    let protoc_bin_path = resource(&format!("vendored/protoc/{bin_name}"))?;
    let protoc_include_dir = resource("vendored/protoc/include")?;
    protoc_bin_path
        .is_file()
        .then_some(yaak_proxy_lib::GrpcConfig { protoc_include_dir, protoc_bin_path })
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
            let mut ctx = ProxyCtx::new(&data_dir, emitter)?;
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
        .invoke_handler(tauri::generate_handler![rpc])
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
                    label: "main_0",
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
