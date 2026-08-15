//! The bridge's engine handles, shared by every route.
//!
//! Structurally this is `CliContext` (crates-cli/yaak-cli/src/context.rs) with
//! an event hub bolted on: the same `init_standalone` database, the same
//! `PluginManager` over the same Node sidecar. What differs is that a browser
//! tab is attached, so writes have to be pushed out as they happen instead of
//! the process exiting when a command finishes.

use crate::events::EventHub;
use crate::plugin_events::BridgePluginEventBridge;
use crate::session::SessionStore;
use include_dir::{Dir, include_dir};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use yaak_crypto::manager::EncryptionManager;
use yaak_http::manager::HttpConnectionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::client_db::ClientDb;
use yaak_models::query_manager::QueryManager;
use yaak_plugins::events::PluginContext;
use yaak_plugins::manager::PluginManager;

const EMBEDDED_PLUGIN_RUNTIME: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../crates-tauri/yaak-app-client/vendored/plugin-runtime/index.cjs"
));
static EMBEDDED_VENDORED_PLUGINS: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../crates-tauri/yaak-app-client/vendored/plugins");

/// What this host can do, mirroring `PlatformCapabilities` in
/// packages/platform/src/types.ts.
///
/// Reported to the browser rather than hardcoded there, because the honest
/// answer depends on how the bridge was built — these become cargo features as
/// the surface grows, and the tab should not have to guess.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeCapabilities {
    pub grpc: bool,
    pub websocket: bool,
    pub git: bool,
    pub sync: bool,
    pub tls_options: bool,
    pub cookie_jar: bool,
    pub local_files: bool,
    pub timeline: bool,
    pub multi_window: bool,
    pub plugins: bool,
    pub encryption: bool,
    pub updater: bool,
    pub clipboard_read: bool,
    pub system_fonts: bool,
    pub license: bool,
}

impl BridgeCapabilities {
    /// The first slice: real HTTP sending with full fidelity, real plugins, a
    /// real cookie jar and timeline. Everything the bridge has no route for is
    /// reported false so the UI hides it rather than calling and failing.
    fn for_this_build(plugins: bool) -> Self {
        Self {
            grpc: false,
            websocket: false,
            git: false,
            sync: false,
            // The engine does the TLS, so client certs and custom CAs are real.
            tls_options: true,
            cookie_jar: true,
            // The bridge has a filesystem but the tab has no way to pick a path
            // on it: there is no dialog implementation on this host.
            local_files: false,
            timeline: true,
            multi_window: false,
            plugins,
            encryption: false,
            updater: false,
            clipboard_read: false,
            system_fonts: false,
            license: false,
        }
    }
}

/// Where a response's body is, and what it is meant to be read as.
pub struct ResponseBodyLocation {
    /// None when the response has no stored body.
    pub path: Option<PathBuf>,
    /// The response's declared `Content-Type`, empty when it has none.
    pub content_type: String,
}

pub struct BridgeState {
    data_dir: PathBuf,
    query_manager: QueryManager,
    blob_manager: BlobManager,
    pub encryption_manager: Arc<EncryptionManager>,
    connection_manager: Arc<HttpConnectionManager>,
    plugin_manager: Option<Arc<PluginManager>>,
    plugin_event_bridge: Mutex<Option<BridgePluginEventBridge>>,
    pub events: EventHub,
    pub session: SessionStore,
    pub capabilities: BridgeCapabilities,
    /// Dev-grade shared secret, minted per process. The seam where OTP pairing
    /// and per-session keys will go; deliberately not persisted.
    pub token: String,
    pub is_dev: bool,
}

impl BridgeState {
    pub fn new(data_dir: PathBuf, app_id: &str, token: String, is_dev: bool) -> Self {
        let db_path = data_dir.join("db.sqlite");
        let blob_path = data_dir.join("blobs.sqlite");
        let (query_manager, blob_manager, rx) =
            match yaak_models::init_standalone(&db_path, &blob_path) {
                Ok(v) => v,
                Err(err) => {
                    eprintln!("Error: Failed to initialize database: {err}");
                    std::process::exit(1);
                }
            };
        let encryption_manager = Arc::new(EncryptionManager::new(query_manager.clone(), app_id));
        let events = EventHub::new();

        // A Settings row has to exist before the frontend's first render — the
        // singular model atom throws without one. `get_settings` upserts a
        // default when it finds nothing, so touching it here is enough.
        let _ = query_manager.connect().get_settings();

        crate::model_writes::start(&query_manager, rx, events.clone());

        Self {
            data_dir,
            query_manager,
            blob_manager,
            encryption_manager,
            connection_manager: Arc::new(HttpConnectionManager::new()),
            plugin_manager: None,
            plugin_event_bridge: Mutex::new(None),
            events,
            session: SessionStore::default(),
            capabilities: BridgeCapabilities::for_this_build(false),
            token,
            is_dev,
        }
    }

    /// Start the Node plugin runtime and the host-request bridge. Mirrors
    /// `CliContext::init_plugins`; a failure here is survivable, but sending
    /// loses auth and template functions, so the capability flips off.
    pub async fn init_plugins(&mut self) {
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
                let plugin_event_bridge = BridgePluginEventBridge::start(
                    plugin_manager.clone(),
                    self.query_manager.clone(),
                    self.blob_manager.clone(),
                    self.encryption_manager.clone(),
                    self.connection_manager.clone(),
                    self.data_dir.clone(),
                    self.events.clone(),
                    self.session.clone(),
                )
                .await;
                self.plugin_manager = Some(plugin_manager);
                *self.plugin_event_bridge.lock().await = Some(plugin_event_bridge);
                self.capabilities.plugins = true;
            }
            Err(err) => {
                log::warn!("Failed to initialize plugins: {err}");
                self.capabilities.plugins = false;
            }
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn response_dir(&self) -> PathBuf {
        self.data_dir.join("responses")
    }

    /// Find a response's body from its id alone.
    ///
    /// The tab hands back an id and never a path, so the only bodies reachable
    /// through the bridge are ones the engine wrote and the database still
    /// knows about. Every route and command that reads a body goes through
    /// here for that reason.
    pub fn locate_response_body(
        &self,
        response_id: &str,
    ) -> yaak_models::error::Result<ResponseBodyLocation> {
        let response = self.db().get_http_response(response_id)?;
        Ok(ResponseBodyLocation {
            path: response.body_path.map(PathBuf::from),
            content_type: response
                .headers
                .iter()
                .find(|h| h.name.eq_ignore_ascii_case("content-type"))
                .map(|h| h.value.clone())
                .unwrap_or_default(),
        })
    }

    pub fn db(&self) -> ClientDb<'_> {
        self.query_manager.connect()
    }

    pub fn query_manager(&self) -> &QueryManager {
        &self.query_manager
    }

    pub fn blob_manager(&self) -> &BlobManager {
        &self.blob_manager
    }

    pub fn connection_manager(&self) -> &HttpConnectionManager {
        &self.connection_manager
    }

    pub fn plugin_manager(&self) -> Option<Arc<PluginManager>> {
        self.plugin_manager.clone()
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
