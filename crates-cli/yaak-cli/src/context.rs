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

#[derive(Clone, Debug, Default)]
pub struct CliExecutionContext {
    pub request_id: Option<String>,
    pub workspace_id: Option<String>,
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
}

pub struct CliContext {
    data_dir: PathBuf,
    query_manager: QueryManager,
    blob_manager: BlobManager,
    pub encryption_manager: Arc<EncryptionManager>,
    plugin_manager: Option<Arc<PluginManager>>,
    plugin_event_bridge: Mutex<Option<CliPluginEventBridge>>,
}

impl CliContext {
    pub fn new(data_dir: PathBuf, app_id: &str) -> Self {
        let db_path = data_dir.join("db.sqlite");
        let blob_path = data_dir.join("blobs.sqlite");
        let (query_manager, blob_manager, _rx) =
            match yaak_models::init_standalone(&db_path, &blob_path) {
                Ok(v) => v,
                Err(err) => {
                    eprintln!("Error: Failed to initialize database: {err}");
                    std::process::exit(1);
                }
            };
        let encryption_manager = Arc::new(EncryptionManager::new(query_manager.clone(), app_id));

        Self {
            data_dir,
            query_manager,
            blob_manager,
            encryption_manager,
            plugin_manager: None,
            plugin_event_bridge: Mutex::new(None),
        }
    }

    pub async fn init_plugins(&mut self, execution_context: CliExecutionContext) {
        let vendored_plugin_dir = self.data_dir.join("vendored-plugins");
        let installed_plugin_dir = self.data_dir.join("installed-plugins");
        let node_bin_path = PathBuf::from("node");

        prepare_embedded_vendored_plugins(&vendored_plugin_dir)
            .expect("Failed to prepare bundled plugins");

        let plugin_runtime_main =
            std::env::var("YAAK_PLUGIN_RUNTIME").map(PathBuf::from).unwrap_or_else(|_| {
                prepare_embedded_plugin_runtime(&self.data_dir)
                    .expect("Failed to prepare embedded plugin runtime")
            });

        match PluginManager::new(
            vendored_plugin_dir,
            installed_plugin_dir,
            node_bin_path,
            plugin_runtime_main,
            &self.query_manager,
            &PluginContext::new_empty(),
            false,
        )
        .await
        {
            Ok(plugin_manager) => {
                let plugin_manager = Arc::new(plugin_manager);
                let plugin_event_bridge = CliPluginEventBridge::start(
                    plugin_manager.clone(),
                    self.query_manager.clone(),
                    self.blob_manager.clone(),
                    self.encryption_manager.clone(),
                    self.data_dir.clone(),
                    execution_context,
                )
                .await;
                self.plugin_manager = Some(plugin_manager);
                *self.plugin_event_bridge.lock().await = Some(plugin_event_bridge);
            }
            Err(err) => {
                eprintln!("Warning: Failed to initialize plugins: {err}");
            }
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
