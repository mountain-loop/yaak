use log::error;
use tauri::{RunEvent, State};
use yaak_proxy_lib::ProxyCtx;
use yaak_rpc::RpcRouter;
use yaak_window::window::CreateWindowConfig;

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
        .manage(ProxyCtx::new())
        .manage(yaak_proxy_lib::build_router())
        .invoke_handler(tauri::generate_handler![rpc])
        .build(tauri::generate_context!())
        .expect("error while building yaak proxy tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Ready = event {
                let config = CreateWindowConfig {
                    url: "/",
                    label: "main",
                    title: "Yaak Proxy",
                    inner_size: Some((1000.0, 700.0)),
                    visible: true,
                    hide_titlebar: true,
                    ..Default::default()
                };
                if let Err(e) = yaak_window::window::create_window(app_handle, config) {
                    error!("Failed to create proxy window: {e:?}");
                }
            }
        });
}
