use serde::Serialize;
use std::sync::Mutex;
use tauri::State;
use yaak_proxy::ProxyHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyMetadata {
    name: String,
    version: String,
}

#[derive(Default)]
struct ProxyState {
    handle: Mutex<Option<ProxyHandle>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyStartResult {
    port: u16,
    already_running: bool,
}

#[tauri::command]
fn proxy_metadata(app_handle: tauri::AppHandle) -> ProxyMetadata {
    ProxyMetadata {
        name: app_handle.package_info().name.clone(),
        version: app_handle.package_info().version.to_string(),
    }
}

#[tauri::command]
fn proxy_start(
    state: State<'_, ProxyState>,
    port: Option<u16>,
) -> Result<ProxyStartResult, String> {
    let mut handle = state.handle.lock().map_err(|_| "failed to lock proxy state".to_string())?;

    if let Some(existing) = handle.as_ref() {
        return Ok(ProxyStartResult { port: existing.port, already_running: true });
    }

    let proxy_handle = yaak_proxy::start_proxy(port.unwrap_or(0))?;
    let started_port = proxy_handle.port;
    *handle = Some(proxy_handle);

    Ok(ProxyStartResult { port: started_port, already_running: false })
}

#[tauri::command]
fn proxy_stop(state: State<'_, ProxyState>) -> Result<bool, String> {
    let mut handle = state.handle.lock().map_err(|_| "failed to lock proxy state".to_string())?;
    Ok(handle.take().is_some())
}

pub fn run() {
    tauri::Builder::default()
        .manage(ProxyState::default())
        .invoke_handler(tauri::generate_handler![proxy_metadata, proxy_start, proxy_stop])
        .run(tauri::generate_context!())
        .expect("error while running yaak proxy tauri application");
}
