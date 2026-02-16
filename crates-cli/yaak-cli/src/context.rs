use std::path::{Path, PathBuf};
use std::sync::Arc;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::db_context::DbContext;
use yaak_models::query_manager::QueryManager;
use yaak_plugins::events::PluginContext;
use yaak_plugins::manager::PluginManager;

pub struct CliContext {
    data_dir: PathBuf,
    query_manager: QueryManager,
    blob_manager: BlobManager,
    pub encryption_manager: Arc<EncryptionManager>,
    plugin_manager: Option<Arc<PluginManager>>,
}

impl CliContext {
    pub async fn initialize(data_dir: PathBuf, app_id: &str, with_plugins: bool) -> Self {
        let db_path = data_dir.join("db.sqlite");
        let blob_path = data_dir.join("blobs.sqlite");

        let (query_manager, blob_manager, _rx) = yaak_models::init_standalone(&db_path, &blob_path)
            .expect("Failed to initialize database");

        let encryption_manager = Arc::new(EncryptionManager::new(query_manager.clone(), app_id));

        let plugin_manager = if with_plugins {
            let vendored_plugin_dir = data_dir.join("vendored-plugins");
            let installed_plugin_dir = data_dir.join("installed-plugins");
            let node_bin_path = PathBuf::from("node");

            let plugin_runtime_main =
                std::env::var("YAAK_PLUGIN_RUNTIME").map(PathBuf::from).unwrap_or_else(|_| {
                    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../../crates-tauri/yaak-app/vendored/plugin-runtime/index.cjs")
                });

            let plugin_manager = Arc::new(
                PluginManager::new(
                    vendored_plugin_dir,
                    installed_plugin_dir,
                    node_bin_path,
                    plugin_runtime_main,
                    false,
                )
                .await,
            );

            let plugins = query_manager.connect().list_plugins().unwrap_or_default();
            if !plugins.is_empty() {
                let errors = plugin_manager
                    .initialize_all_plugins(plugins, &PluginContext::new_empty())
                    .await;
                for (plugin_dir, error_msg) in errors {
                    eprintln!(
                        "Warning: Failed to initialize plugin '{}': {}",
                        plugin_dir, error_msg
                    );
                }
            }

            Some(plugin_manager)
        } else {
            None
        };

        Self { data_dir, query_manager, blob_manager, encryption_manager, plugin_manager }
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
            plugin_manager.terminate().await;
        }
    }
}
