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

    if let Some(proxy) = get_system_proxy() {
        builder = builder.proxy(proxy);
    }

    Ok(builder.build()?)
}

/// Returns the system proxy URL if one is enabled, e.g. `http://host:port`.
pub fn get_system_proxy_url() -> Option<String> {
    let sys = match sysproxy::Sysproxy::get_system_proxy() {
        Ok(sys) if sys.enable => sys,
        Ok(_) => {
            debug!("System proxy detected but not enabled");
            return None;
        }
        Err(e) => {
            debug!("Could not detect system proxy: {e}");
            return None;
        }
    };

    let url = format!("http://{}:{}", sys.host, sys.port);
    debug!("Detected system proxy: {url}");
    Some(url)
}

fn get_system_proxy() -> Option<reqwest::Proxy> {
    let sys = match sysproxy::Sysproxy::get_system_proxy() {
        Ok(sys) if sys.enable => sys,
        Ok(_) => {
            debug!("System proxy detected but not enabled");
            return None;
        }
        Err(e) => {
            debug!("Could not detect system proxy: {e}");
            return None;
        }
    };

    let proxy_url = format!("http://{}:{}", sys.host, sys.port);
    debug!("Detected system proxy: {proxy_url}");

    match reqwest::Proxy::all(&proxy_url) {
        Ok(p) => {
            let p = if !sys.bypass.is_empty() {
                p.no_proxy(reqwest::NoProxy::from_string(&sys.bypass))
            } else {
                p
            };
            Some(p)
        }
        Err(e) => {
            warn!("Failed to configure system proxy: {e}");
            None
        }
    }
}
