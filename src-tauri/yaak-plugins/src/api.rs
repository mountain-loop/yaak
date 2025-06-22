use crate::commands::{PluginSearchResponse, PluginVersion};
use crate::error::Result;
use reqwest::{Response, Url};
use std::str::FromStr;
use log::info;
use tauri::{AppHandle, Runtime, is_dev};
use yaak_common::api_client::yaak_api_client;
use crate::error::Error::ApiErr;

pub async fn get_plugin<R: Runtime>(
    app_handle: &AppHandle<R>,
    name: &str,
    version: Option<String>,
) -> Result<PluginVersion> {
    info!("Getting plugin: {name} {version:?}");
    let mut url = base_url(&format!("/{name}"));
    if let Some(version) = version {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("version", &version);
    };
    let resp = yaak_api_client(app_handle)?.get(url.clone()).send().await?;
    if !resp.status().is_success() {
        return Err(ApiErr(format!("{} response to {}", resp.status(), url.to_string())));
    }
    Ok(resp.json().await?)
}

pub async fn download_plugin_archive<R: Runtime>(
    app_handle: &AppHandle<R>,
    plugin_version: &PluginVersion,
) -> Result<Response> {
    let name = plugin_version.name.clone();
    let version = plugin_version.version.clone();
    info!("Downloading plugin: {name} {version}");
    let mut url = base_url(&format!("/{}/download", name));
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("version", &version);
    };
    let resp = yaak_api_client(app_handle)?.get(url.clone()).send().await?;
    if !resp.status().is_success() {
        return Err(ApiErr(format!("{} response to {}", resp.status(), url.to_string())));
    }
    Ok(resp)
}

pub async fn search_plugins<R: Runtime>(
    app_handle: &AppHandle<R>,
    query: &str,
) -> Result<PluginSearchResponse> {
    let mut url = base_url("/search");
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("query", query);
    };
    let resp = yaak_api_client(app_handle)?.get(url).send().await?;
    Ok(resp.json().await?)
}

fn base_url(path: &str) -> Url {
    let base_url = if is_dev() {
        "http://localhost:9444/api/v1/plugins"
    } else {
        "https://api.yaak.app/api/v1/plugins"
    };
    Url::from_str(&format!("{base_url}{path}")).unwrap()
}
