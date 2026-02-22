use crate::error::{Error, Result};
use crate::events::PluginContext;
use crate::manager::PluginManager;
use std::path::PathBuf;
use std::sync::Arc;
use yaak_models::models::Plugin;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;

/// Create a plugin manager and initialize all registered plugins.
///
/// This performs:
/// 1. Plugin runtime startup (`PluginManager::new`)
/// 2. Bundled plugin registration in DB (if missing)
/// 3. Plugin initialization from DB
pub async fn create_and_initialize_manager(
    vendored_plugin_dir: PathBuf,
    installed_plugin_dir: PathBuf,
    node_bin_path: PathBuf,
    plugin_runtime_main: PathBuf,
    query_manager: &QueryManager,
    plugin_context: &PluginContext,
    dev_mode: bool,
) -> Result<Arc<PluginManager>> {
    let plugin_manager = Arc::new(
        PluginManager::new(
            vendored_plugin_dir,
            installed_plugin_dir,
            node_bin_path,
            plugin_runtime_main,
            dev_mode,
        )
        .await,
    );

    let bundled_dirs = plugin_manager.list_bundled_plugin_dirs().await?;
    let db = query_manager.connect();
    for dir in bundled_dirs {
        if db.get_plugin_by_directory(&dir).is_none() {
            db.upsert_plugin(
                &Plugin {
                    directory: dir,
                    enabled: true,
                    url: None,
                    ..Default::default()
                },
                &UpdateSource::Background,
            )?;
        }
    }

    let plugins = db.list_plugins()?;
    drop(db);

    let init_errors = plugin_manager.initialize_all_plugins(plugins, plugin_context).await;
    if !init_errors.is_empty() {
        let joined = init_errors
            .into_iter()
            .map(|(dir, err)| format!("{dir}: {err}"))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(Error::PluginErr(format!("Failed to initialize plugin(s): {joined}")));
    }

    Ok(plugin_manager)
}
