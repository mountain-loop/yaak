mod error;

pub use error::{Error, Result};

use log::{debug, warn};
use reqwest::Client;
use reqwest::header::{HeaderMap, HeaderValue};
use std::time::Duration;
use yaak_common::platform::{get_ua_arch, get_ua_platform};

/// Build a reqwest Client configured for Yaak's own API calls.
///
/// Includes a custom User-Agent, JSON accept header, 20s timeout, gzip,
/// and automatic OS-level proxy detection via sysproxy.
pub fn yaak_api_client(version: &str) -> Result<Client> {
    let platform = get_ua_platform();
    let arch = get_ua_arch();
    let ua = format!("Yaak/{version} ({platform}; {arch})");

    let mut default_headers = HeaderMap::new();
    default_headers.insert("Accept", HeaderValue::from_str("application/json").unwrap());

    let mut builder = reqwest::ClientBuilder::new()
        .timeout(Duration::from_secs(20))
        .default_headers(default_headers)
        .gzip(true)
        .user_agent(ua);

    if let Some(sys) = get_enabled_system_proxy() {
        let proxy_url = format!("http://{}:{}", sys.host, sys.port);
        match reqwest::Proxy::all(&proxy_url) {
            Ok(p) => {
                let p = if !sys.bypass.is_empty() {
                    p.no_proxy(reqwest::NoProxy::from_string(&sys.bypass))
                } else {
                    p
                };
                builder = builder.proxy(p);
            }
            Err(e) => {
                warn!("Failed to configure system proxy: {e}");
            }
        }
    }

    Ok(builder.build()?)
}

/// Returns the system proxy URL if one is enabled, e.g. `http://host:port`.
pub fn get_system_proxy_url() -> Option<String> {
    let sys = get_enabled_system_proxy()?;
    Some(format!("http://{}:{}", sys.host, sys.port))
}

fn get_enabled_system_proxy() -> Option<sysproxy::Sysproxy> {
    match sysproxy::Sysproxy::get_system_proxy() {
        Ok(sys) if sys.enable => {
            debug!("Detected system proxy: http://{}:{}", sys.host, sys.port);
            Some(sys)
        }
        Ok(_) => {
            debug!("System proxy detected but not enabled");
            None
        }
        Err(e) => {
            debug!("Could not detect system proxy: {e}");
            None
        }
    }
}
