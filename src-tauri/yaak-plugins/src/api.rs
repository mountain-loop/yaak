use crate::error::Error::ApiErr;
use crate::commands::{PluginSearchResponse, PluginVersion};
use crate::error::Result;
use crate::plugin_meta::get_plugin_meta;
use log::{info, warn};
use reqwest::{Response, Url};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::str::FromStr;
use log::info;
use tauri::{AppHandle, Runtime, is_dev};
use ts_rs::TS;
use yaak_common::api_client::yaak_api_client;
use yaak_models::query_manager::QueryManagerExt;
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

pub async fn check_plugin_updates<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<PluginUpdatesResponse> {
    let name_versions: Vec<PluginNameVersion> = app_handle
        .db()
        .list_plugins()?
        .into_iter()
        .filter_map(|p| match get_plugin_meta(&Path::new(&p.directory)) {
            Ok(m) => Some(PluginNameVersion {
                name: m.name,
                version: m.version,
            }),
            Err(e) => {
                warn!("Failed to get plugin metadata: {}", e);
                None
            }
        })
        .collect();

    let url = base_url("/updates");
    let body = serde_json::to_vec(&PluginUpdatesResponse {
        plugins: name_versions,
    })?;
    let resp = yaak_api_client(app_handle)?.post(url.clone()).body(body).send().await?;
    if !resp.status().is_success() {
        return Err(ApiErr(format!("{} response to {}", resp.status(), url.to_string())));
    }

    let results: PluginUpdatesResponse = resp.json().await?;
    Ok(results)
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

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_search.ts")]
pub struct PluginVersion {
    pub id: String,
    pub version: String,
    pub description: Option<String>,
    pub name: String,
    pub display_name: String,
    pub homepage_url: Option<String>,
    pub repository_url: Option<String>,
    pub checksum: String,
    pub readme: Option<String>,
    pub yanked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_api.ts")]
pub struct PluginSearchResponse {
    pub plugins: Vec<PluginVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_api.ts")]
pub struct PluginNameVersion {
    name: String,
    version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_api.ts")]
pub struct PluginUpdatesResponse {
    pub plugins: Vec<PluginNameVersion>,
}
