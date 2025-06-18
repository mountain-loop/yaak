use crate::commands::{PluginSearchResponse, PluginVersion};
use crate::error::Result;
use reqwest::Url;
use std::str::FromStr;
use tauri::is_dev;

pub async fn get_plugin(url: &str, version: Option<String>) -> Result<PluginVersion> {
    let mut url = base_url(&format!("/{url}"));
    if let Some(version) = version {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("version", &version);
    };
    let resp = reqwest::get(url).await?;
    Ok(resp.json().await?)
}

pub async fn search_plugins(query: &str) -> Result<PluginSearchResponse> {
    let mut url = base_url("/search");
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("query", query);
    };
    let resp = reqwest::get(url).await?;
    Ok(resp.json().await?)
}

fn base_url(path: &str) -> Url {
    let url_str = if is_dev() {
        format!("http://localhost:9444/plugins/api{path}")
    } else {
        format!("http://localhost:9444/plugins/api{path}")
        // format!("https://plugins.yaak.app/plugins/api{path}")
    };

    Url::from_str(&url_str).unwrap()
}
