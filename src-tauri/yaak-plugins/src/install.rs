use crate::api::download_plugin_archive;
use crate::checksum::compute_checksum;
use crate::commands::PluginVersion;
use crate::error::Error::PluginErr;
use crate::error::Result;
use crate::events::PluginWindowContext;
use crate::manager::PluginManager;
use chrono::Utc;
use log::info;
use std::fs::create_dir_all;
use std::io::Cursor;
use tauri::{Manager, Runtime, WebviewWindow};
use yaak_models::models::Plugin;
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::{UpdateSource, generate_id};

pub async fn download_and_install<R: Runtime>(
    window: &WebviewWindow<R>,
    plugin_version: &PluginVersion,
) -> Result<String> {
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

    let plugin_dir = window.path().app_data_dir()?.join("plugins").join(generate_id());
    let plugin_dir_str = plugin_dir.to_str().unwrap().to_string();
    create_dir_all(&plugin_dir)?;

    zip_extract::extract(Cursor::new(&bytes), &plugin_dir, true)?;
    info!("Extracted plugin {} to {}", plugin_version.id, plugin_dir_str);

    let plugin_manager = window.state::<PluginManager>();
    plugin_manager.add_plugin_by_dir(&PluginWindowContext::new(&window), &plugin_dir_str).await?;

    let p = window.db().upsert_plugin(
        &Plugin {
            id: plugin_version.id.clone(),
            checked_at: Some(Utc::now().naive_utc()),
            directory: plugin_dir_str.clone(),
            enabled: true,
            url: None,
            ..Default::default()
        },
        &UpdateSource::Background,
    )?;

    info!("Installed plugin {} to {}", plugin_version.id, plugin_dir_str);

    Ok(p.id)
}
