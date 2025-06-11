use crate::checksum::compute_checksum;
use crate::error::Error::PluginErr;
use crate::error::Result;
use crate::events::PluginWindowContext;
use crate::manager::PluginManager;
use chrono::Utc;
use log::info;
use serde::{Deserialize, Serialize};
use std::fs::create_dir_all;
use std::io::Cursor;
use std::str::FromStr;
use tauri::{Manager, Runtime, State, Url, WebviewWindow, command};
use ts_rs::TS;
use yaak_models::models::Plugin;
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::{UpdateSource, generate_id};

#[command]
pub(crate) async fn search(query: &str) -> Result<PluginSearchResponse> {
    let mut url = Url::from_str("http://localhost:9444/plugins/api/search").unwrap();
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("query", query);
    };
    let resp = reqwest::get(url).await?;
    let items: PluginSearchResponse = resp.json().await?;
    Ok(items)
}

#[command]
pub(crate) async fn install<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
    plugin: PluginVersion,
) -> Result<String> {
    let resp = reqwest::Client::new().get(plugin.download_url.as_str()).send().await?;
    let bytes = resp.bytes().await?;

    let checksum = compute_checksum(&bytes);
    if checksum != plugin.checksum {
        return Err(PluginErr("Checksum mismatch".to_string()));
    }

    info!("Checksum matched {}", checksum);

    let plugin_dir = window.path().app_data_dir()?.join("plugins").join(generate_id());
    let plugin_dir_str = plugin_dir.to_str().unwrap().to_string();
    create_dir_all(&plugin_dir)?;

    zip_extract::extract(Cursor::new(&bytes), &plugin_dir, true)?;
    info!("Extracted plugin {} to {}", plugin.id, plugin_dir_str);

    plugin_manager
        .add_plugin_by_dir(&PluginWindowContext::new(&window), &plugin_dir_str, true)
        .await?;

    let p = window.db().upsert_plugin(
        &Plugin {
            id: plugin.id.clone(),
            checked_at: Some(Utc::now().naive_utc()),
            directory: plugin_dir_str.clone(),
            enabled: true,
            url: None,
            ..Default::default()
        },
        &UpdateSource::Background,
    )?;

    info!("Installed plugin {} to {}", plugin.id, plugin_dir_str);

    Ok(p.id)
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
