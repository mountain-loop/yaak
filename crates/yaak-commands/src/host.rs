//! What a command needs from whatever is running it.
//!
//! A command handler is invoked on behalf of one client (a desktop window today)
//! and needs a handful of things from its surroundings: the shared engine
//! managers, who the client is, what the client is looking at, and a little
//! about the app. `Host` is that handful and nothing more. The desktop
//! implements it over a `WebviewWindow`; a server would implement it over a
//! connection. Handlers are generic over it, so the same handler body runs
//! under either without knowing which.
//!
//! The surface grows only when a handler being moved here needs something new,
//! and stays as narrow as those handlers allow. What is deliberately *not* here
//! is anything only a desktop can do — open a native window, run the updater,
//! show a native dialog — those handlers stay with the desktop.

use yaak_core::WorkspaceContext;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::{BlobContext, BlobManager};
use yaak_models::client_db::ClientDb;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::PluginContext;
use yaak_plugins::manager::PluginManager;

pub trait Host: Clone + Send + Sync + 'static {
    /// Stable identity of the client this call is for. On the desktop this is
    /// the window label. It rides on every model write so the client that made
    /// a change can tell its own echo from everyone else's.
    fn client_id(&self) -> &str;

    /// What the client is currently looking at: workspace, environment, cookie
    /// jar, request. Read at call time, since the client can navigate between
    /// calls (and during one).
    fn session(&self) -> WorkspaceContext;

    /// The app version, as reported to the Yaak API and stamped on exports.
    fn app_version(&self) -> String;

    fn query_manager(&self) -> &QueryManager;
    fn blob_manager(&self) -> &BlobManager;
    fn encryption_manager(&self) -> &EncryptionManager;

    // -- Conveniences derived from the above; hosts do not override these --

    fn update_source(&self) -> UpdateSource {
        UpdateSource::from_window_label(self.client_id())
    }

    fn plugin_context(&self) -> PluginContext {
        PluginContext::new(Some(self.client_id().to_string()), self.session().workspace_id)
    }

    fn db(&self) -> ClientDb<'_> {
        self.query_manager().connect()
    }

    fn blobs(&self) -> BlobContext {
        self.blob_manager().connect()
    }
}

/// A host that can also reach plugins.
///
/// Separate from [`Host`] because the plugin runtime is the one piece that is
/// not the same shape everywhere. `PluginManager` *is* "spawn a Node sidecar
/// and talk to it"; a browser host runs plugins in a Worker it reaches by
/// message instead, and cannot hand back a `&PluginManager` at all.
///
/// Keeping it out of `Host` also stops a command that only touches the
/// database from demanding a plugin runtime it never calls: a host with no
/// plugins can still serve those, and only handlers bounded on `PluginHost`
/// are closed to it.
pub trait PluginHost: Host {
    fn plugin_manager(&self) -> &PluginManager;
}
