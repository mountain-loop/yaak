use crate::api::{PluginVersion, download_plugin_archive, get_plugin};
use crate::checksum::compute_checksum;
use crate::error::Error::PluginErr;
use crate::error::Result;
use crate::events::PluginWindowContext;
use crate::manager::PluginManager;
use chrono::Utc;
use log::info;
use std::fs::{create_dir_all, remove_dir_all};
use std::io::Cursor;
use tauri::{Manager, Runtime, WebviewWindow};
use yaak_models::models::Plugin;
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;

pub async fn delete_and_uninstall<R: Runtime>(window: &WebviewWindow<R>, plugin_id: &str) -> Result<Plugin> {
    let plugin_manager = window.state::<PluginManager>();
    let plugin = window.db().delete_plugin_by_id(plugin_id, &UpdateSource::from_window(&window))?;
    plugin_manager.uninstall(&PluginWindowContext::new(&window), plugin.directory.as_str()).await?;
    Ok(plugin)
}

pub async fn download_and_install<R: Runtime>(
    window: &WebviewWindow<R>,
    name: &str,
    version: Option<String>,
) -> Result<PluginVersion> {
    let plugin_manager = window.state::<PluginManager>();
    let plugin_version = get_plugin(window.app_handle(), name, version).await?;
    let resp = download_plugin_archive(window.app_handle(), &plugin_version).await?;
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

    plugin_manager.add_plugin_by_dir(&PluginWindowContext::new(&window), &plugin_dir_str).await?;

    window.db().upsert_plugin(
        &Plugin {
            id: plugin_version.id.clone(),
            checked_at: Some(Utc::now().naive_utc()),
            directory: plugin_dir_str.clone(),
            enabled: true,
            url: Some(plugin_version.url.clone()),
            ..Default::default()
        },
        &UpdateSource::Background,
    )?;

    info!("Installed plugin {} to {}", plugin_version.id, plugin_dir_str);

    Ok(plugin_version)
}
