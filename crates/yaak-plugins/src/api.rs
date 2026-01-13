use crate::error::Error::ApiErr;
use crate::error::Result;
use crate::plugin_meta::get_plugin_meta;
use log::{info, warn};
use reqwest::{Client, Response, Url};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::str::FromStr;
use ts_rs::TS;
use yaak_models::models::Plugin;

/// Get plugin info from the registry.
pub async fn get_plugin(
    http_client: &Client,
    name: &str,
    version: Option<String>,
) -> Result<PluginVersion> {
    info!("Getting plugin: {name} {version:?}");
    let mut url = build_url(&format!("/{name}"));
    if let Some(version) = version {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("version", &version);
    };
    let resp = http_client.get(url.clone()).send().await?;
    if !resp.status().is_success() {
        return Err(ApiErr(format!("{} response to {}", resp.status(), url.to_string())));
    }
    Ok(resp.json().await?)
}

/// Download the plugin archive from the registry.
pub async fn download_plugin_archive(
    http_client: &Client,
    plugin_version: &PluginVersion,
) -> Result<Response> {
    let name = plugin_version.name.clone();
    let version = plugin_version.version.clone();
    info!("Downloading plugin: {name} {version}");
    let mut url = build_url(&format!("/{}/download", name));
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("version", &version);
    };
    let resp = http_client.get(url.clone()).send().await?;
    if !resp.status().is_success() {
        warn!("Failed to download plugin: {name} {version}");
        return Err(ApiErr(format!("{} response to {}", resp.status(), url.to_string())));
    }
    info!("Downloaded plugin: {url}");
    Ok(resp)
}

/// Check for plugin updates.
/// Takes a list of plugins to check against the registry.
pub async fn check_plugin_updates(
    http_client: &Client,
    plugins: Vec<Plugin>,
) -> Result<PluginUpdatesResponse> {
    let name_versions: Vec<PluginNameVersion> = plugins
        .into_iter()
        .filter(|p| p.url.is_some()) // Only check plugins with URLs (from registry)
        .filter_map(|p| match get_plugin_meta(&Path::new(&p.directory)) {
            Ok(m) => Some(PluginNameVersion { name: m.name, version: m.version }),
            Err(e) => {
                warn!("Failed to get plugin metadata: {}", e);
                None
            }
        })
        .collect();

    let url = build_url("/updates");
    let body = serde_json::to_vec(&PluginUpdatesResponse { plugins: name_versions })?;
    let resp = http_client.post(url.clone()).body(body).send().await?;
    if !resp.status().is_success() {
        return Err(ApiErr(format!("{} response to {}", resp.status(), url.to_string())));
    }

    let results: PluginUpdatesResponse = resp.json().await?;
    Ok(results)
}

/// Search for plugins in the registry.
pub async fn search_plugins(http_client: &Client, query: &str) -> Result<PluginSearchResponse> {
    let mut url = build_url("/search");
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("query", query);
    };
    let resp = http_client.get(url).send().await?;
    Ok(resp.json().await?)
}

fn build_url(path: &str) -> Url {
    let base_url = "https://api.yaak.app/api/v1/plugins";
    Url::from_str(&format!("{base_url}{path}")).unwrap()
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_search.ts")]
pub struct PluginVersion {
    pub id: String,
    pub version: String,
    pub url: String,
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
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_api.ts")]
pub struct PluginUpdatesResponse {
    pub plugins: Vec<PluginNameVersion>,
}
