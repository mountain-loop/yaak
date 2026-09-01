//! A host that is nothing but the trait: a temp database, a fixed client id,
//! a fixed session. It exists to prove that the handlers really do run without
//! a desktop around them, and that the client's identity reaches the writes.
//!
//! Neither host here has a plugin runtime — no `PluginManager`, no sidecar.
//! `TestHost` implements `Host` alone, so a handler that reaches for plugins
//! would not compile against it. `SingleThreadedHost` goes further and answers
//! `PluginHost` too, without one, which is only possible because that trait
//! names operations rather than handing back a manager.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use yaak_commands::auth::cmd_get_http_authentication_config;
use yaak_commands::models::{
    cmd_default_headers, cmd_get_workspace_meta, models_delete, models_upsert,
    models_workspace_models,
};
use yaak_commands::templates::{cmd_render_template, cmd_template_function_config};
use yaak_commands::{Host, PluginHost};
use yaak_core::WorkspaceContext;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{AnyModel, Environment, EnvironmentVariable, Plugin, Workspace};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{ModelPayload, UpdateSource};
use yaak_plugins::events::{
    CallFolderActionRequest, CallGrpcRequestActionRequest, CallHttpRequestActionRequest,
    CallWebsocketRequestActionRequest, CallWorkspaceActionRequest, GetFolderActionsResponse,
    GetGrpcRequestActionsResponse, GetHttpAuthenticationConfigResponse,
    GetHttpAuthenticationSummaryResponse, GetHttpRequestActionsResponse,
    GetTemplateFunctionConfigResponse, GetTemplateFunctionSummaryResponse, GetThemesResponse,
    GetWebsocketRequestActionsResponse, GetWorkspaceActionsResponse, ImportResponse, JsonPrimitive,
    RenderPurpose,
};
use yaak_plugins::plugin_meta::PluginMetadata;
use yaak_rpc_schema::{
    CmdDefaultHeadersReq, CmdGetWorkspaceMetaReq, CmdRenderTemplateReq, ModelsDeleteReq,
    ModelsUpsertReq, ModelsWorkspaceModelsReq,
};
use yaak_templates::TemplateCallback;

#[derive(Clone)]
struct TestHost {
    inner: Arc<Inner>,
}

struct Inner {
    _dir: TempDir,
    query_manager: QueryManager,
    blob_manager: BlobManager,
    encryption_manager: EncryptionManager,
    /// Every model write the database reported, so a test can check who it
    /// says made them.
    writes: Mutex<Vec<ModelPayload>>,
    rx: Mutex<std::sync::mpsc::Receiver<ModelPayload>>,
}

impl TestHost {
    fn new() -> Self {
        let dir = TempDir::new().expect("temp dir");
        let (query_manager, blob_manager, rx) = yaak_models::init_standalone(
            dir.path().join("db.sqlite"),
            dir.path().join("blobs.sqlite"),
        )
        .expect("init db");
        let encryption_manager = EncryptionManager::new(query_manager.clone(), "app.yaak.test");
        Self {
            inner: Arc::new(Inner {
                _dir: dir,
                query_manager,
                blob_manager,
                encryption_manager,
                writes: Mutex::new(Vec::new()),
                rx: Mutex::new(rx),
            }),
        }
    }

    fn drain_writes(&self) -> Vec<ModelPayload> {
        let rx = self.inner.rx.lock().unwrap();
        let mut writes = self.inner.writes.lock().unwrap();
        while let Ok(payload) = rx.try_recv() {
            writes.push(payload);
        }
        writes.drain(..).collect()
    }
}

impl Host for TestHost {
    fn client_id(&self) -> &str {
        "test-client"
    }

    fn session(&self) -> WorkspaceContext {
        WorkspaceContext::new().with_workspace("wk_test")
    }

    fn app_version(&self) -> String {
        "0.0.0-test".to_string()
    }

    fn query_manager(&self) -> &QueryManager {
        &self.inner.query_manager
    }

    fn blob_manager(&self) -> &BlobManager {
        &self.inner.blob_manager
    }

    fn encryption_manager(&self) -> &EncryptionManager {
        &self.inner.encryption_manager
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_carry_the_client_id() {
    let host = TestHost::new();

    let workspace = Workspace { name: "From a test".to_string(), ..Default::default() };
    let id = models_upsert(host.clone(), ModelsUpsertReq { model: AnyModel::Workspace(workspace) })
        .await
        .expect("upsert");
    assert!(id.starts_with("wk_"), "unexpected id {id}");

    let writes = host.drain_writes();
    assert_eq!(writes.len(), 1);
    assert!(
        matches!(&writes[0].update_source, UpdateSource::Window { label } if label == "test-client"),
        "the write should be attributed to the calling client, got {:?}",
        writes[0].update_source,
    );

    let meta =
        cmd_get_workspace_meta(host.clone(), CmdGetWorkspaceMetaReq { workspace_id: id.clone() })
            .await
            .expect("workspace meta");
    assert_eq!(meta.workspace_id, id);

    // Deletes cascade inside a transaction; make sure that path works with no
    // host doing anything special around it.
    let workspace = host.db().get_workspace(&id).expect("get workspace");
    let deleted =
        models_delete(host.clone(), ModelsDeleteReq { model: AnyModel::Workspace(workspace) })
            .await
            .expect("delete");
    assert_eq!(deleted, id);
    assert!(host.db().get_workspace(&id).is_err(), "workspace should be gone");
}

#[tokio::test]
async fn host_free_handlers_need_no_state() {
    let host = TestHost::new();
    let headers = cmd_default_headers(host, CmdDefaultHeadersReq {}).await.expect("headers");
    assert!(!headers.is_empty());
}

/// A host that is deliberately **not** `Send` or `Sync`: it keeps its state in
/// an `Rc`, the way a single-threaded browser host has to, since
/// `rusqlite::Connection` is not `Sync` to begin with. It also has no plugin
/// runtime of any kind — no `PluginManager`, no sidecar, nothing to spawn.
///
/// Nothing here asserts much at runtime; the test is largely that it compiles.
/// A `Host` demanding thread-safety, or a `PluginHost` handing back a
/// `&PluginManager`, would shut such a host out of the traits entirely and this
/// file would stop building.
#[derive(Clone)]
struct SingleThreadedHost {
    inner: Rc<Inner>,
    /// The values the last auth-config call arrived with, so a test can check
    /// they were rendered before the host ever saw them.
    auth_values: Rc<RefCell<Option<HashMap<String, JsonPrimitive>>>>,
    /// Same, for the last template-function-config call.
    fn_values: Rc<RefCell<Option<HashMap<String, JsonPrimitive>>>>,
}

impl Host for SingleThreadedHost {
    fn client_id(&self) -> &str {
        "tab-1"
    }

    fn session(&self) -> WorkspaceContext {
        WorkspaceContext::new()
    }

    fn app_version(&self) -> String {
        "0.0.0-web".to_string()
    }

    fn query_manager(&self) -> &QueryManager {
        &self.inner.query_manager
    }

    fn blob_manager(&self) -> &BlobManager {
        &self.inner.blob_manager
    }

    fn encryption_manager(&self) -> &EncryptionManager {
        &self.inner.encryption_manager
    }
}

/// A template callback with no plugins behind it: variables still resolve,
/// function calls have nothing to run them. A browser host would put a Worker
/// round-trip where this returns an error.
struct NoTemplateFunctions;

impl TemplateCallback for NoTemplateFunctions {
    async fn run(
        &self,
        fn_name: &str,
        _args: HashMap<String, serde_json::Value>,
    ) -> yaak_templates::error::Result<String> {
        Err(yaak_templates::error::Error::RenderError(format!(
            "no plugin runtime to run {fn_name}()"
        )))
    }

    fn transform_arg(
        &self,
        _fn_name: &str,
        _arg_name: &str,
        arg_value: &str,
    ) -> yaak_templates::error::Result<String> {
        Ok(arg_value.to_string())
    }
}

/// Answering plugin questions with no plugin runtime behind them. A browser
/// host would put a `postMessage` round-trip to its Worker where these return
/// constants; the shape of the trait is what makes either possible.
impl PluginHost for SingleThreadedHost {
    async fn loaded_plugin_metadata(&self, _directory: &str) -> Option<PluginMetadata> {
        None
    }

    async fn take_plugin_init_errors(&self) -> Vec<(String, String)> {
        Vec::new()
    }

    async fn resolve_plugins(&self, plugins: Vec<Plugin>) -> Vec<Plugin> {
        // No runtime to enrich them with; the database rows are still the truth
        // about what is installed.
        plugins
    }

    async fn encrypt_secure_template(&self, _template: &str) -> yaak_commands::Result<String> {
        Err(yaak_commands::Error::Generic("no plugin runtime on this host".into()))
    }

    async fn template_callback(
        &self,
        _purpose: RenderPurpose,
    ) -> yaak_commands::Result<impl TemplateCallback> {
        Ok(NoTemplateFunctions)
    }

    async fn template_function_summaries(
        &self,
    ) -> yaak_commands::Result<Vec<GetTemplateFunctionSummaryResponse>> {
        Ok(Vec::new())
    }

    async fn template_function_config(
        &self,
        function_name: &str,
        values: HashMap<String, JsonPrimitive>,
        _model_id: &str,
    ) -> yaak_commands::Result<GetTemplateFunctionConfigResponse> {
        *self.fn_values.borrow_mut() = Some(values);
        Err(yaak_commands::Error::Generic(format!("no plugin provides {function_name}()")))
    }

    async fn themes(&self) -> yaak_commands::Result<Vec<GetThemesResponse>> {
        Ok(Vec::new())
    }

    // No plugins, so nothing contributes actions and nothing can run one.

    async fn http_request_actions(
        &self,
    ) -> yaak_commands::Result<Vec<GetHttpRequestActionsResponse>> {
        Ok(Vec::new())
    }

    async fn websocket_request_actions(
        &self,
    ) -> yaak_commands::Result<Vec<GetWebsocketRequestActionsResponse>> {
        Ok(Vec::new())
    }

    async fn grpc_request_actions(
        &self,
    ) -> yaak_commands::Result<Vec<GetGrpcRequestActionsResponse>> {
        Ok(Vec::new())
    }

    async fn workspace_actions(&self) -> yaak_commands::Result<Vec<GetWorkspaceActionsResponse>> {
        Ok(Vec::new())
    }

    async fn folder_actions(&self) -> yaak_commands::Result<Vec<GetFolderActionsResponse>> {
        Ok(Vec::new())
    }

    async fn call_http_request_action(
        &self,
        _req: CallHttpRequestActionRequest,
    ) -> yaak_commands::Result<()> {
        Err(no_plugins())
    }

    async fn call_grpc_request_action(
        &self,
        _req: CallGrpcRequestActionRequest,
    ) -> yaak_commands::Result<()> {
        Err(no_plugins())
    }

    async fn call_websocket_request_action(
        &self,
        _req: CallWebsocketRequestActionRequest,
    ) -> yaak_commands::Result<()> {
        Err(no_plugins())
    }

    async fn call_workspace_action(
        &self,
        _req: CallWorkspaceActionRequest,
    ) -> yaak_commands::Result<()> {
        Err(no_plugins())
    }

    async fn call_folder_action(&self, _req: CallFolderActionRequest) -> yaak_commands::Result<()> {
        Err(no_plugins())
    }

    async fn http_authentication_summaries(
        &self,
    ) -> yaak_commands::Result<Vec<GetHttpAuthenticationSummaryResponse>> {
        Ok(Vec::new())
    }

    async fn http_authentication_config(
        &self,
        _auth_name: &str,
        values: HashMap<String, JsonPrimitive>,
        _model_id: &str,
    ) -> yaak_commands::Result<GetHttpAuthenticationConfigResponse> {
        *self.auth_values.borrow_mut() = Some(values);
        Err(no_plugins())
    }

    async fn call_http_authentication_action(
        &self,
        _auth_name: &str,
        _action_index: i32,
        _values: HashMap<String, JsonPrimitive>,
        _model_id: &str,
    ) -> yaak_commands::Result<()> {
        Err(no_plugins())
    }

    async fn import_data(&self, _content: &str) -> yaak_commands::Result<ImportResponse> {
        Err(no_plugins())
    }

    async fn reload_plugins(&self, _plugins: Vec<Plugin>) -> Vec<(String, String)> {
        Vec::new()
    }
}

fn no_plugins() -> yaak_commands::Error {
    yaak_commands::Error::Generic("no plugin runtime on this host".into())
}

#[tokio::test]
async fn a_single_threaded_host_can_implement_the_trait() {
    let TestHost { inner } = TestHost::new();
    let host = SingleThreadedHost {
        inner: Rc::new(Arc::into_inner(inner).expect("sole owner")),
        auth_values: Rc::new(RefCell::new(None)),
        fn_values: Rc::new(RefCell::new(None)),
    };

    let workspace = Workspace { name: "From one thread".to_string(), ..Default::default() };
    let id = models_upsert(host.clone(), ModelsUpsertReq { model: AnyModel::Workspace(workspace) })
        .await
        .expect("upsert");

    // A `PluginHost` command, on a host with no plugin runtime at all. This is
    // the one that could not be written when the trait handed back a
    // `&PluginManager`.
    let json = models_workspace_models(
        host.clone(),
        ModelsWorkspaceModelsReq { workspace_id: Some(id.clone()) },
    )
    .await
    .expect("workspace models");
    assert!(json.contains(&id), "the workspace should be in its own bootstrap payload");

    // Rendering, on a host whose template callback has no plugins behind it.
    // Resolving the environment chain is a database read and the render is
    // shared code; only the callback came from the host. Rendering a real
    // variable is what proves the chain was resolved rather than skipped.
    let environment = host
        .db()
        .upsert_environment(
            &Environment {
                workspace_id: id.clone(),
                name: "Test env".to_string(),
                variables: vec![EnvironmentVariable {
                    enabled: true,
                    name: "greeting".to_string(),
                    value: "hello".to_string(),
                    id: None,
                }],
                ..Default::default()
            },
            &host.update_source(),
        )
        .expect("seed environment");

    let rendered = cmd_render_template(
        host.clone(),
        CmdRenderTemplateReq {
            template: "${[ greeting ]} world".to_string(),
            workspace_id: id.clone(),
            environment_id: Some(environment.id.clone()),
            purpose: None,
            ignore_error: None,
        },
    )
    .await
    .expect("render");
    assert_eq!(rendered, "hello world", "the environment chain should have been resolved");

    // The delete path too, since it is the one that used to reach for a
    // blocking thread this host does not have.
    let workspace = host.db().get_workspace(&id).expect("get workspace");
    let deleted = models_delete(host, ModelsDeleteReq { model: AnyModel::Workspace(workspace) })
        .await
        .expect("delete");
    assert_eq!(deleted, id);
}

/// Auth form values may contain templates, and a plugin must never see one
/// unrendered. The rendering happens in the shared handler, so this checks the
/// host received a resolved value rather than `${[ ... ]}`.
#[tokio::test]
async fn auth_values_are_rendered_before_the_host_sees_them() {
    let TestHost { inner } = TestHost::new();
    let host = SingleThreadedHost {
        inner: Rc::new(Arc::into_inner(inner).expect("sole owner")),
        auth_values: Rc::new(RefCell::new(None)),
        fn_values: Rc::new(RefCell::new(None)),
    };

    let workspace = host
        .db()
        .upsert_workspace(
            &Workspace { name: "Auth".to_string(), ..Default::default() },
            &host.update_source(),
        )
        .expect("workspace");
    host.db()
        .upsert_environment(
            &Environment {
                workspace_id: workspace.id.clone(),
                name: "Env".to_string(),
                variables: vec![EnvironmentVariable {
                    enabled: true,
                    name: "token".to_string(),
                    value: "s3cret".to_string(),
                    id: None,
                }],
                ..Default::default()
            },
            &host.update_source(),
        )
        .expect("environment");
    let environment =
        host.db().list_environments_ensure_base(&workspace.id).expect("list").remove(0);

    let mut values = HashMap::new();
    values.insert("password".to_string(), JsonPrimitive::String("${[ token ]}".to_string()));

    // The host refuses the call itself — it has no plugins — but only after the
    // handler has rendered and handed over the values, which is what matters.
    let _ = cmd_get_http_authentication_config(
        host.clone(),
        yaak_rpc_schema::CmdGetHttpAuthenticationConfigReq {
            auth_name: "basic".to_string(),
            values,
            model: AnyModel::Workspace(workspace),
            environment_id: Some(environment.id),
        },
    )
    .await;

    let seen = host.auth_values.borrow().clone().expect("the host should have been called");
    assert!(
        matches!(seen.get("password"), Some(JsonPrimitive::String(v)) if v == "s3cret"),
        "the template should have been rendered before reaching the host, got {:?}",
        seen.get("password"),
    );
}

/// Same contract as auth: template function argument values may contain
/// templates (the 1Password token argument defaults to `${[1PASSWORD_TOKEN]}`),
/// and the shared handler renders them before the host is called.
#[tokio::test]
async fn template_function_values_are_rendered_before_the_host_sees_them() {
    let TestHost { inner } = TestHost::new();
    let host = SingleThreadedHost {
        inner: Rc::new(Arc::into_inner(inner).expect("sole owner")),
        auth_values: Rc::new(RefCell::new(None)),
        fn_values: Rc::new(RefCell::new(None)),
    };

    let workspace = host
        .db()
        .upsert_workspace(
            &Workspace { name: "Functions".to_string(), ..Default::default() },
            &host.update_source(),
        )
        .expect("workspace");
    host.db()
        .upsert_environment(
            &Environment {
                workspace_id: workspace.id.clone(),
                name: "Env".to_string(),
                variables: vec![EnvironmentVariable {
                    enabled: true,
                    name: "1PASSWORD_TOKEN".to_string(),
                    value: "ops_abc123".to_string(),
                    id: None,
                }],
                ..Default::default()
            },
            &host.update_source(),
        )
        .expect("environment");
    let environment =
        host.db().list_environments_ensure_base(&workspace.id).expect("list").remove(0);

    let mut values = HashMap::new();
    values.insert("token".to_string(), JsonPrimitive::String("${[1PASSWORD_TOKEN]}".to_string()));

    // The host refuses the call itself — it has no plugins — but only after the
    // handler has rendered and handed over the values, which is what matters.
    let _ = cmd_template_function_config(
        host.clone(),
        yaak_rpc_schema::CmdTemplateFunctionConfigReq {
            function_name: "1password.item".to_string(),
            values,
            model: AnyModel::Workspace(workspace),
            environment_id: Some(environment.id),
        },
    )
    .await;

    let seen = host.fn_values.borrow().clone().expect("the host should have been called");
    assert!(
        matches!(seen.get("token"), Some(JsonPrimitive::String(v)) if v == "ops_abc123"),
        "the template should have been rendered before reaching the host, got {:?}",
        seen.get("token"),
    );
}
