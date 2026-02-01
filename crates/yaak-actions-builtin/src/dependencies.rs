//! Dependency injection for built-in actions.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::query_manager::QueryManager;
use yaak_plugins::events::PluginContext;
use yaak_plugins::manager::PluginManager;

/// Dependencies needed by built-in action implementations.
///
/// This struct bundles all the dependencies that action handlers need,
/// providing a clean way to initialize them in different contexts
/// (CLI, Tauri app, MCP server, etc.).
pub struct BuiltinActionDependencies {
    pub query_manager: Arc<QueryManager>,
    pub plugin_manager: Arc<PluginManager>,
    pub encryption_manager: Arc<EncryptionManager>,
}

impl BuiltinActionDependencies {
    /// Create dependencies for standalone usage (CLI, MCP server, etc.)
    ///
    /// This initializes all the necessary managers following the same pattern
    /// as the yaak-cli implementation.
    pub async fn new_standalone(
        db_path: &Path,
        blob_path: &Path,
        app_id: &str,
        plugin_vendored_dir: PathBuf,
        plugin_installed_dir: PathBuf,
        node_path: PathBuf,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        // Initialize database
        let (query_manager, _, _) = yaak_models::init_standalone(db_path, blob_path)?;

        // Initialize encryption manager (takes QueryManager by value)
        let encryption_manager = Arc::new(EncryptionManager::new(
            query_manager.clone(),
            app_id.to_string(),
        ));

        let query_manager = Arc::new(query_manager);

        // Find plugin runtime
        let plugin_runtime_main = std::env::var("YAAK_PLUGIN_RUNTIME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                // Development fallback
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../crates-tauri/yaak-app/vendored/plugin-runtime/index.cjs")
            });

        // Initialize plugin manager
        let plugin_manager = Arc::new(
            PluginManager::new(
                plugin_vendored_dir,
                plugin_installed_dir,
                node_path,
                plugin_runtime_main,
                false, // not sandboxed in CLI
            )
            .await,
        );

        // Initialize plugins from database
        let db = query_manager.connect();
        let plugins = db.list_plugins().unwrap_or_default();
        if !plugins.is_empty() {
            let errors = plugin_manager
                .initialize_all_plugins(plugins, &PluginContext::new_empty())
                .await;
            for (plugin_dir, error_msg) in errors {
                log::warn!(
                    "Failed to initialize plugin '{}': {}",
                    plugin_dir,
                    error_msg
                );
            }
        }

        Ok(Self {
            query_manager,
            plugin_manager,
            encryption_manager,
        })
    }
}
