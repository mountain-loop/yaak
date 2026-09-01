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

use std::collections::HashMap;
use std::future::Future;
use yaak_core::WorkspaceContext;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::{BlobContext, BlobManager};
use yaak_models::client_db::ClientDb;
use yaak_models::models::Plugin;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    CallFolderActionRequest, CallGrpcRequestActionRequest, CallHttpRequestActionRequest,
    CallWebsocketRequestActionRequest, CallWorkspaceActionRequest, GetFolderActionsResponse,
    GetGrpcRequestActionsResponse, GetHttpAuthenticationConfigResponse,
    GetHttpAuthenticationSummaryResponse, GetHttpRequestActionsResponse,
    GetTemplateFunctionConfigResponse, GetTemplateFunctionSummaryResponse, GetThemesResponse,
    GetWebsocketRequestActionsResponse, GetWorkspaceActionsResponse, ImportResponse, JsonPrimitive,
    PluginContext, RenderPurpose,
};
use yaak_plugins::plugin_meta::PluginMetadata;
use yaak_templates::TemplateCallback;

/// Only `Clone` is required here. `Send`/`Sync`/`'static` are deliberately
/// *not*: a browser host is single-threaded and its connection pool is an
/// `Rc<Connection>` — `rusqlite::Connection` is not `Sync` to begin with — so a
/// thread-safety bound on the trait would lock that host out of implementing it
/// at all. The router needs those bounds and states them itself, which is where
/// they belong: they are a property of a particular transport, not of a command.
pub trait Host: Clone {
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
/// Separate from [`Host`] so that a command which only touches the database
/// never demands a plugin runtime it does not call: a host with no plugins
/// still serves those, and only handlers bounded on `PluginHost` are closed to
/// it.
///
/// These are *operations*, not a handle. Handing back a `&PluginManager` would
/// have been shorter, but that type is specifically "spawn a Node sidecar and
/// talk to it over a socket", and a browser host runs plugins in a Worker it
/// reaches by message — it can answer any of the questions below and can never
/// produce that type. Naming the questions instead of the answerer is what lets
/// both hosts exist.
///
/// Same rule as [`Host`]: this grows only when a migrated handler needs
/// something new, and stays as narrow as those handlers allow. Today it is the
/// four things batch 1 asks for.
///
/// The types crossing this boundary still come from `yaak-plugins` — fine on
/// the desktop, and once its plain data types are split out from its runtime
/// that becomes an import-path change here rather than an interface one.
pub trait PluginHost: Host {
    /// What the running plugin runtime knows about the plugin installed in
    /// `directory`, or `None` if it has not loaded one from there. Callers fall
    /// back to reading the plugin's manifest off disk.
    fn loaded_plugin_metadata(
        &self,
        directory: &str,
    ) -> impl Future<Output = Option<PluginMetadata>>;

    /// Failures from plugin initialization, drained — reporting them clears
    /// them, so a caller that drops these has lost them.
    fn take_plugin_init_errors(&self) -> impl Future<Output = Vec<(String, String)>>;

    /// The plugin rows as the runtime sees them: the database says what is
    /// installed, the runtime knows which are bundled and what version actually
    /// loaded. A host without a runtime can return them untouched.
    fn resolve_plugins(&self, plugins: Vec<Plugin>) -> impl Future<Output = Vec<Plugin>>;

    /// The template functions this host can run, as a callback the renderer
    /// drives. This is the *only* thing the plugin runtime uniquely provides to
    /// a render — the variables come from the environment chain, which is an
    /// ordinary database read — so handing back the callback keeps the rest of
    /// rendering shared instead of pushing whole commands behind this trait.
    /// Async so hosts that finish booting their plugin runtime in the
    /// background can wait for it here.
    fn template_callback(
        &self,
        purpose: RenderPurpose,
    ) -> impl Future<Output = crate::Result<impl TemplateCallback>>;

    /// Every template function the installed plugins expose, for the
    /// autocomplete menu.
    fn template_function_summaries(
        &self,
    ) -> impl Future<Output = crate::Result<Vec<GetTemplateFunctionSummaryResponse>>>;

    /// The form a template function wants to show for the given values.
    /// `values` arrive already rendered.
    fn template_function_config(
        &self,
        function_name: &str,
        values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> impl Future<Output = crate::Result<GetTemplateFunctionConfigResponse>>;

    /// Themes contributed by plugins.
    fn themes(&self) -> impl Future<Output = crate::Result<Vec<GetThemesResponse>>>;

    // -- Actions plugins contribute to the UI --

    fn http_request_actions(
        &self,
    ) -> impl Future<Output = crate::Result<Vec<GetHttpRequestActionsResponse>>>;
    fn websocket_request_actions(
        &self,
    ) -> impl Future<Output = crate::Result<Vec<GetWebsocketRequestActionsResponse>>>;
    fn grpc_request_actions(
        &self,
    ) -> impl Future<Output = crate::Result<Vec<GetGrpcRequestActionsResponse>>>;
    fn workspace_actions(
        &self,
    ) -> impl Future<Output = crate::Result<Vec<GetWorkspaceActionsResponse>>>;
    fn folder_actions(&self) -> impl Future<Output = crate::Result<Vec<GetFolderActionsResponse>>>;

    /// Running an action. The request in each of these has already been
    /// re-read and had its inheritance resolved by the handler; a host must
    /// pass it through untouched.
    fn call_http_request_action(
        &self,
        req: CallHttpRequestActionRequest,
    ) -> impl Future<Output = crate::Result<()>>;
    fn call_grpc_request_action(
        &self,
        req: CallGrpcRequestActionRequest,
    ) -> impl Future<Output = crate::Result<()>>;
    fn call_websocket_request_action(
        &self,
        req: CallWebsocketRequestActionRequest,
    ) -> impl Future<Output = crate::Result<()>>;
    fn call_workspace_action(
        &self,
        req: CallWorkspaceActionRequest,
    ) -> impl Future<Output = crate::Result<()>>;
    fn call_folder_action(
        &self,
        req: CallFolderActionRequest,
    ) -> impl Future<Output = crate::Result<()>>;

    // -- Authentication --

    fn http_authentication_summaries(
        &self,
    ) -> impl Future<Output = crate::Result<Vec<GetHttpAuthenticationSummaryResponse>>>;

    /// The form an auth plugin wants to show. `values` arrive already rendered.
    fn http_authentication_config(
        &self,
        auth_name: &str,
        values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> impl Future<Output = crate::Result<GetHttpAuthenticationConfigResponse>>;

    fn call_http_authentication_action(
        &self,
        auth_name: &str,
        action_index: i32,
        values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> impl Future<Output = crate::Result<()>>;

    // -- The importers, and the runtime itself --

    /// Hand arbitrary text to the importer plugins and take what they make of
    /// it. Used for files, URLs and pasted `curl` commands alike.
    fn import_data(&self, content: &str) -> impl Future<Output = crate::Result<ImportResponse>>;

    /// Restart every plugin, returning `(plugin, error)` for those that failed.
    fn reload_plugins(&self, plugins: Vec<Plugin>) -> impl Future<Output = Vec<(String, String)>>;

    /// Re-encrypt the `secure(...)` values in a template.
    ///
    /// Whole operation rather than its pieces because the encryption is only
    /// half of it: the value is also run through the plugin template functions,
    /// so this needs the plugin runtime and not just a key.
    fn encrypt_secure_template(
        &self,
        template: &str,
    ) -> impl Future<Output = crate::Result<String>>;
}
