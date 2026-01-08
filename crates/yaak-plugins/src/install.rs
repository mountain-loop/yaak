use crate::api::{PluginVersion, download_plugin_archive, get_plugin};
use crate::checksum::compute_checksum;
use crate::error::Error::PluginErr;
use crate::error::Result;
use crate::events::PluginContext;
use crate::manager::PluginManager;
use chrono::Utc;
use log::info;
use std::fs::{create_dir_all, remove_dir_all};
use std::io::Cursor;
use std::sync::Arc;
use yaak_models::models::Plugin;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;

/// Delete a plugin from the database and uninstall it.
pub async fn delete_and_uninstall(
    plugin_manager: Arc<PluginManager>,
    query_manager: &QueryManager,
    plugin_context: &PluginContext,
    plugin_id: &str,
) -> Result<Plugin> {
    let update_source = match plugin_context.label.clone() {
        Some(label) => UpdateSource::from_window_label(label),
        None => UpdateSource::Background,
    };
    // Scope the db connection so it doesn't live across await
    let plugin = {
        let db = query_manager.connect();
        db.delete_plugin_by_id(plugin_id, &update_source)?
    };
    plugin_manager.uninstall(plugin_context, plugin.directory.as_str()).await?;
    Ok(plugin)
}

/// Download and install a plugin.
pub async fn download_and_install(
    plugin_manager: Arc<PluginManager>,
    query_manager: &QueryManager,
    http_client: &reqwest::Client,
    plugin_context: &PluginContext,
    name: &str,
    version: Option<String>,
) -> Result<PluginVersion> {
    info!("Installing plugin {} {}", name, version.clone().unwrap_or_default());
    let plugin_version = get_plugin(http_client, name, version).await?;
    let resp = download_plugin_archive(http_client, &plugin_version).await?;
    let bytes = resp.bytes().await?;

    let checksum = compute_checksum(&bytes);
    if checksum != plugin_version.checksum {
        return Err(PluginErr(format!(
            "Checksum mismatch {}b {checksum} != {}",
            bytes.len(),
            plugin_version.checksum
        )));
    }

    info!("Checksum matched {}", checksum);

    let plugin_dir = plugin_manager.installed_plugin_dir.join(name);
    let plugin_dir_str = plugin_dir.to_str().unwrap().to_string();

    // Re-create the plugin directory
    let _ = remove_dir_all(&plugin_dir);
    create_dir_all(&plugin_dir)?;

    zip_extract::extract(Cursor::new(&bytes), &plugin_dir, true)?;
    info!("Extracted plugin {} to {}", plugin_version.id, plugin_dir_str);

    // Scope the db connection so it doesn't live across await
    let plugin = {
        let db = query_manager.connect();
        db.upsert_plugin(
            &Plugin {
                id: plugin_version.id.clone(),
                checked_at: Some(Utc::now().naive_utc()),
                directory: plugin_dir_str.clone(),
                enabled: true,
                url: Some(plugin_version.url.clone()),
                ..Default::default()
            },
            &UpdateSource::Background,
        )?
    };

    plugin_manager.add_plugin(plugin_context, &plugin).await?;

    info!("Installed plugin {} to {}", plugin_version.id, plugin_dir_str);

    Ok(plugin_version)
}
