use crate::plugin_events::CliPluginEventBridge;
use include_dir::{Dir, include_dir};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::db_context::DbContext;
use yaak_models::query_manager::QueryManager;
use yaak_plugins::events::PluginContext;
use yaak_plugins::manager::PluginManager;

const EMBEDDED_PLUGIN_RUNTIME: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../crates-tauri/yaak-app/vendored/plugin-runtime/index.cjs"
));
static EMBEDDED_VENDORED_PLUGINS: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../crates-tauri/yaak-app/vendored/plugins");

pub struct CliContext {
    data_dir: PathBuf,
    query_manager: QueryManager,
    blob_manager: BlobManager,
    pub encryption_manager: Arc<EncryptionManager>,
    plugin_manager: Option<Arc<PluginManager>>,
    plugin_event_bridge: Mutex<Option<CliPluginEventBridge>>,
}

impl CliContext {
    pub async fn initialize(data_dir: PathBuf, app_id: &str, with_plugins: bool) -> Self {
        let db_path = data_dir.join("db.sqlite");
        let blob_path = data_dir.join("blobs.sqlite");

        let (query_manager, blob_manager, _rx) = yaak_models::init_standalone(&db_path, &blob_path)
            .expect("Failed to initialize database");

        let encryption_manager = Arc::new(EncryptionManager::new(query_manager.clone(), app_id));

        let plugin_manager = if with_plugins {
            let embedded_vendored_plugin_dir = data_dir.join("vendored-plugins");
            let vendored_plugin_dir =
                resolve_bundled_plugin_dir_for_cli(&embedded_vendored_plugin_dir);
            let installed_plugin_dir = data_dir.join("installed-plugins");
            let node_bin_path = PathBuf::from("node");

            if vendored_plugin_dir == embedded_vendored_plugin_dir {
                prepare_embedded_vendored_plugins(&vendored_plugin_dir)
                    .expect("Failed to prepare bundled plugins");
            }

            let plugin_runtime_main =
                std::env::var("YAAK_PLUGIN_RUNTIME").map(PathBuf::from).unwrap_or_else(|_| {
                    prepare_embedded_plugin_runtime(&data_dir)
                        .expect("Failed to prepare embedded plugin runtime")
                });

            match PluginManager::new(
                vendored_plugin_dir,
                installed_plugin_dir,
                node_bin_path,
                plugin_runtime_main,
                &query_manager,
                &PluginContext::new_empty(),
            )
            .await
            {
                Ok(plugin_manager) => Some(Arc::new(plugin_manager)),
                Err(err) => {
                    eprintln!("Warning: Failed to initialize plugins: {err}");
                    None
                }
            }
        } else {
            None
        };

        let plugin_event_bridge = if let Some(plugin_manager) = &plugin_manager {
            Some(CliPluginEventBridge::start(plugin_manager.clone(), query_manager.clone()).await)
        } else {
            None
        };

        Self {
            data_dir,
            query_manager,
            blob_manager,
            encryption_manager,
            plugin_manager,
            plugin_event_bridge: Mutex::new(plugin_event_bridge),
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn db(&self) -> DbContext<'_> {
        self.query_manager.connect()
    }

    pub fn query_manager(&self) -> &QueryManager {
        &self.query_manager
    }

    pub fn blob_manager(&self) -> &BlobManager {
        &self.blob_manager
    }

    pub fn plugin_manager(&self) -> Arc<PluginManager> {
        self.plugin_manager.clone().expect("Plugin manager was not initialized for this command")
    }

    pub async fn shutdown(&self) {
        if let Some(plugin_manager) = &self.plugin_manager {
            if let Some(plugin_event_bridge) = self.plugin_event_bridge.lock().await.take() {
                plugin_event_bridge.shutdown(plugin_manager).await;
            }
            plugin_manager.terminate().await;
        }
    }
}

fn prepare_embedded_plugin_runtime(data_dir: &Path) -> std::io::Result<PathBuf> {
    let runtime_dir = data_dir.join("vendored").join("plugin-runtime");
    fs::create_dir_all(&runtime_dir)?;
    let runtime_main = runtime_dir.join("index.cjs");
    fs::write(&runtime_main, EMBEDDED_PLUGIN_RUNTIME)?;
    Ok(runtime_main)
}

fn prepare_embedded_vendored_plugins(vendored_plugin_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(vendored_plugin_dir)?;
    EMBEDDED_VENDORED_PLUGINS.extract(vendored_plugin_dir)?;
    Ok(())
}

fn resolve_workspace_plugins_dir() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("plugins")
        .canonicalize()
        .ok()
}

fn resolve_bundled_plugin_dir_for_cli(embedded_vendored_plugin_dir: &Path) -> PathBuf {
    if !use_workspace_plugins_for_cli_dev() {
        return embedded_vendored_plugin_dir.to_path_buf();
    }

    resolve_workspace_plugins_dir().unwrap_or_else(|| {
        panic!(
            "YAAK_USE_WORKSPACE_PLUGINS is enabled, but ROOT/plugins could not be resolved"
        )
    })
}

fn use_workspace_plugins_for_cli_dev() -> bool {
    std::env::var("YAAK_USE_WORKSPACE_PLUGINS")
        .ok()
        .map(|v| {
            let v = v.trim();
            v.eq_ignore_ascii_case("1")
                || v.eq_ignore_ascii_case("true")
                || v.eq_ignore_ascii_case("yes")
                || v.eq_ignore_ascii_case("on")
        })
        .unwrap_or(false)
}
