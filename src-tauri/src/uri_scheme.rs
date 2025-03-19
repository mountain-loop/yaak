use log::{info, warn};
use tauri::{Manager, Runtime, UriSchemeContext};

pub(crate) fn handle_uri_scheme<R: Runtime>(
    a: UriSchemeContext<R>,
    req: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    println!("------------- Yaak URI scheme invoked!");
    let uri = req.uri();
    let window = a
        .app_handle()
        .get_webview_window(a.webview_label())
        .expect("Failed to get webview window for URI scheme event");
    info!("Yaak URI scheme invoked with {uri:?} {window:?}");

    let path = uri.path();
    if path == "/data/import" {
        warn!("TODO: import data")
    } else if path == "/plugins/install" {
        warn!("TODO: install plugin")
    }

    let msg = format!("No handler found for {path}");
    tauri::http::Response::builder().status(404).body(msg.as_bytes().to_vec()).unwrap()
}
