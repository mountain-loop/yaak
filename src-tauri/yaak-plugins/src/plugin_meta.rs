use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_search.ts")]
pub struct PluginMetadata {
    pub version: String,
    pub name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub homepage_url: Option<String>,
    pub repository_url: Option<String>,
}

pub(crate) fn get_plugin_meta(plugin_dir: &Path) -> Result<PluginMetadata> {
    let package_json = fs::File::open(plugin_dir.join("package.json"))?;
    let package_json: PackageJson = serde_json::from_reader(package_json)?;

    let display_name = match package_json.display_name {
        None => {
            let display_name = package_json.name.to_string();
            let display_name = display_name.split('/').last().unwrap_or(&package_json.name);
            let display_name = display_name.strip_prefix("yaak-plugin-").unwrap_or(&display_name);
            let display_name = display_name.strip_prefix("yaak-").unwrap_or(&display_name);
            display_name.to_string()
        }
        Some(n) => n,
    };

    Ok(PluginMetadata {
        version: package_json.version,
        description: package_json.description,
        name: package_json.name,
        display_name,
        homepage_url: package_json.homepage,
        repository_url: match package_json.repository {
            None => None,
            Some(RepositoryField::Object { url }) => Some(url),
            Some(RepositoryField::String(url)) => Some(url),
        },
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageJson {
    pub name: String,
    pub display_name: Option<String>,
    pub version: String,
    pub repository: Option<RepositoryField>,
    pub homepage: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RepositoryField {
    String(String),
    Object { url: String },
}
