use log::{error, info, warn};
use std::sync::Mutex;
use tauri::Runtime;
use tauri::{Emitter, Manager, RunEvent, State, WebviewWindow};
use yaak_proxy_lib::ProxyCtx;
use yaak_proxy_lib::control::{self, ControlServer};
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

/// The control API, served while this app owns the engine.
struct Control(Mutex<Option<ControlServer>>);

/// Claims the engine and serves the control API, unless a live owner (the CLI daemon) has it.
fn host_control_api(ctx: &ProxyCtx) -> Option<ControlServer> {
    // Read first: a crashed owner's file names the port its system proxy may still point at.
    let previous = control::read(ctx.data_dir());
    if let Some(owner) = control::live_owner(ctx.data_dir()) {
        // Starting the engine here is refused too, until the owner stops.
        warn!(
            "The proxy engine is owned by {:?} (pid {}), so this app does not serve the control API",
            owner.owner, owner.pid
        );
        return None;
    }
    let server = match ControlServer::start(ctx.clone()) {
        Ok(server) => server,
        Err(e) => {
            error!("Failed to start the proxy control API: {e}");
            return None;
        }
    };

    let mut ports: Vec<u16> = previous.and_then(|p| p.proxy_port).into_iter().collect();
    ports.extend(ctx.settings().ok().map(|s| s.port));
    let ctx = ctx.clone();
    std::thread::spawn(move || {
        if let Err(e) = ctx.reset_stale_system_proxy(&ports) {
            warn!("Failed to reset a stale system proxy: {e}");
        }
    });
    Some(server)
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
        .plugin(yaak_mac_window::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");

            let (emitter, event_rx) = RpcEventEmitter::new();
            let ctx = ProxyCtx::new(&data_dir, emitter)?;
            app.manage(Control(Mutex::new(host_control_api(&ctx))));
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
                app_handle.state::<ProxyCtx>().shutdown();
                if let Ok(mut control) = app_handle.state::<Control>().0.lock() {
                    control.take();
                }
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
