use crate::api::search_plugins;
use crate::error::Result;
use crate::install::download_and_install;
use serde::{Deserialize, Serialize};
use tauri::{Runtime, WebviewWindow, command};
use ts_rs::TS;

#[command]
pub(crate) async fn search(query: &str) -> Result<PluginSearchResponse> {
    search_plugins(query).await
}

#[command]
pub(crate) async fn install<R: Runtime>(
    window: WebviewWindow<R>,
    plugin: PluginVersion,
) -> Result<String> {
    download_and_install(&window, &plugin).await
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_search.ts")]
pub struct PluginSearchResponse {
    pub results: Vec<PluginVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_search.ts")]
pub struct PluginVersion {
    pub id: String,
    pub version: String,
    pub description: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "homepageUrl")]
    pub homepage_url: Option<String>,
    #[serde(rename = "repositoryUrl")]
    pub repository_url: Option<String>,
    pub checksum: String,
    pub readme: Option<String>,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
    pub yanked: bool,
}
