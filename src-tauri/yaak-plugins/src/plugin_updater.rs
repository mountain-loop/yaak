use std::time::Instant;

use log::{error, info};
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime, WebviewWindow};
use ts_rs::TS;
use yaak_models::query_manager::QueryManagerExt;

use crate::api::check_plugin_updates;
use crate::error::Result;

const MAX_UPDATE_CHECK_HOURS: u64 = 12;

pub struct PluginUpdater {
    last_check: Option<Instant>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub struct PluginUpdateNotification {
    pub update_count: usize,
    pub plugins: Vec<PluginUpdateInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub struct PluginUpdateInfo {
    pub name: String,
    pub current_version: String,
    pub latest_version: String,
}

impl PluginUpdater {
    pub fn new() -> Self {
        Self { last_check: None }
    }

    pub async fn check_now<R: Runtime>(&mut self, window: &WebviewWindow<R>) -> Result<bool> {
        self.last_check = Some(Instant::now());

        info!("Checking for plugin updates");

        let updates = check_plugin_updates(&window.app_handle()).await?;

        if updates.plugins.is_empty() {
            info!("No plugin updates available");
            return Ok(false);
        }

        // Get current plugin versions to build notification
        let plugins = window.app_handle().db().list_plugins()?;
        let mut update_infos = Vec::new();

        for update in &updates.plugins {
            if let Some(plugin) = plugins.iter().find(|p| {
                if let Ok(meta) =
                    crate::plugin_meta::get_plugin_meta(&std::path::Path::new(&p.directory))
                {
                    meta.name == update.name
                } else {
                    false
                }
            }) {
                if let Ok(meta) =
                    crate::plugin_meta::get_plugin_meta(&std::path::Path::new(&plugin.directory))
                {
                    update_infos.push(PluginUpdateInfo {
                        name: update.name.clone(),
                        current_version: meta.version,
                        latest_version: update.version.clone(),
                    });
                }
            }
        }

        let notification =
            PluginUpdateNotification { update_count: update_infos.len(), plugins: update_infos };

        info!("Found {} plugin update(s)", notification.update_count);

        if let Err(e) = window.emit_to(window.label(), "plugin_updates_available", &notification) {
            error!("Failed to emit plugin_updates_available event: {}", e);
        }

        Ok(true)
    }

    pub async fn maybe_check<R: Runtime>(&mut self, window: &WebviewWindow<R>) -> Result<bool> {
        let update_period_seconds = MAX_UPDATE_CHECK_HOURS * 60 * 60;

        if let Some(i) = self.last_check
            && i.elapsed().as_secs() < update_period_seconds
        {
            return Ok(false);
        }

        self.check_now(window).await
    }
}
