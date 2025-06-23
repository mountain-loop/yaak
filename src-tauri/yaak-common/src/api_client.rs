use crate::error::Result;
use crate::platform::get_ua_platform;
use reqwest::Client;
use std::time::Duration;
use tauri::http::{HeaderMap, HeaderValue};
use tauri::{AppHandle, Runtime};

pub fn yaak_api_client<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Client> {
    let platform = get_ua_platform();
    let version = app_handle.package_info().version.clone();
    let ua = format!("Yaak/{version} ({platform})");
    let mut default_headers = HeaderMap::new();
    default_headers.insert("Accept", HeaderValue::from_str("application/json").unwrap());

    let client = reqwest::ClientBuilder::new()
        .timeout(Duration::from_secs(20))
        .default_headers(default_headers)
        .gzip(true)
        .user_agent(ua)
        .build()?;

    Ok(client)
}
