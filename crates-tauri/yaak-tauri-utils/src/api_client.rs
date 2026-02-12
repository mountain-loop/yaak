use crate::error::Result;
use log::{debug, warn};
use reqwest::{Client, Proxy};
use std::time::Duration;
use tauri::http::{HeaderMap, HeaderValue};
use tauri::{AppHandle, Manager, Runtime};
use yaak_common::platform::{get_ua_arch, get_ua_platform};
use yaak_models::models::{ProxySetting, ProxySettingAuth};
use yaak_models::query_manager::QueryManager;

pub fn yaak_api_client<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Client> {
    let platform = get_ua_platform();
    let version = app_handle.package_info().version.clone();
    let arch = get_ua_arch();
    let ua = format!("Yaak/{version} ({platform}; {arch})");
    let mut default_headers = HeaderMap::new();
    default_headers.insert("Accept", HeaderValue::from_str("application/json").unwrap());

    let mut builder = reqwest::ClientBuilder::new()
        .timeout(Duration::from_secs(20))
        .default_headers(default_headers)
        .gzip(true)
        .user_agent(ua);

    // Apply proxy settings from global app settings
    let qm = app_handle.state::<QueryManager>();
    let db = qm.inner().connect();
    let proxy = db.get_settings().proxy;
    match &proxy {
        None => { /* System default */ }
        Some(ProxySetting::Disabled) => {
            builder = builder.no_proxy();
        }
        Some(ProxySetting::Enabled { http, https, auth, bypass, disabled }) => {
            if !disabled {
                if !http.is_empty() {
                    match Proxy::http(http) {
                        Ok(mut p) => {
                            if let Some(ProxySettingAuth { user, password }) = auth {
                                debug!("Using http proxy auth");
                                p = p.basic_auth(user.as_str(), password.as_str());
                            }
                            p = p.no_proxy(reqwest::NoProxy::from_string(bypass));
                            builder = builder.proxy(p);
                        }
                        Err(e) => {
                            warn!("Failed to apply http proxy: {e:?}");
                        }
                    }
                }

                if !https.is_empty() {
                    match Proxy::https(https) {
                        Ok(mut p) => {
                            if let Some(ProxySettingAuth { user, password }) = auth {
                                debug!("Using https proxy auth");
                                p = p.basic_auth(user.as_str(), password.as_str());
                            }
                            p = p.no_proxy(reqwest::NoProxy::from_string(bypass));
                            builder = builder.proxy(p);
                        }
                        Err(e) => {
                            warn!("Failed to apply https proxy: {e:?}");
                        }
                    }
                }
            }
        }
    }

    let client = builder.build()?;
    Ok(client)
}
