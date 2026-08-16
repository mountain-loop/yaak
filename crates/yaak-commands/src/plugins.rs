//! Plugin queries that only need the plugin manager and the database.

use crate::error::Result;
use crate::host::PluginHost;
use std::path::PathBuf;
use yaak_plugins::plugin_meta::{PluginMetadata, get_plugin_meta};
use yaak_rpc_schema::*;

pub async fn cmd_plugin_info<H: PluginHost>(
    host: H,
    req: CmdPluginInfoReq,
) -> Result<PluginMetadata> {
    let plugin = host.db().get_plugin(&req.id)?;
    if let Some(plugin_handle) =
        host.plugin_manager().get_plugin_by_dir(plugin.directory.as_str()).await
    {
        return Ok(plugin_handle.info());
    }

    if let Ok(metadata) = get_plugin_meta(&PathBuf::from(&plugin.directory)) {
        return Ok(metadata);
    }

    Ok(fallback_plugin_metadata(&plugin.directory))
}

fn fallback_plugin_metadata(directory: &str) -> PluginMetadata {
    let display_name = PathBuf::from(directory)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(directory)
        .to_string();

    PluginMetadata {
        version: "Unavailable".to_string(),
        name: directory.to_string(),
        display_name,
        description: Some(format!("Plugin metadata could not be loaded from {directory}")),
        homepage_url: None,
        repository_url: None,
    }
}

pub async fn cmd_plugin_init_errors<H: PluginHost>(
    host: H,
    _req: CmdPluginInitErrorsReq,
) -> Result<Vec<(String, String)>> {
    Ok(host.plugin_manager().take_init_errors().await)
}
