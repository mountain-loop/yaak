//! A host that is nothing but the trait: a temp database, a fixed client id,
//! a fixed session. It exists to prove that the handlers really do run without
//! a desktop around them, and that the client's identity reaches the writes.
//!
//! Neither host here has a plugin runtime — no `PluginManager`, no sidecar.
//! `TestHost` implements `Host` alone, so a handler that reaches for plugins
//! would not compile against it. `SingleThreadedHost` goes further and answers
//! `PluginHost` too, without one, which is only possible because that trait
//! names operations rather than handing back a manager.

use std::rc::Rc;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use yaak_commands::models::{
    cmd_default_headers, cmd_get_workspace_meta, models_delete, models_upsert,
    models_workspace_models,
};
use yaak_commands::{Host, PluginHost};
use yaak_core::WorkspaceContext;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{AnyModel, Plugin, Workspace};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{ModelPayload, UpdateSource};
use yaak_plugins::plugin_meta::PluginMetadata;
use yaak_rpc_schema::{
    CmdDefaultHeadersReq, CmdGetWorkspaceMetaReq, ModelsDeleteReq, ModelsUpsertReq,
    ModelsWorkspaceModelsReq,
};

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
}

#[tokio::test]
async fn a_single_threaded_host_can_implement_the_trait() {
    let TestHost { inner } = TestHost::new();
    let host = SingleThreadedHost { inner: Rc::new(Arc::into_inner(inner).expect("sole owner")) };

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

    // The delete path too, since it is the one that used to reach for a
    // blocking thread this host does not have.
    let workspace = host.db().get_workspace(&id).expect("get workspace");
    let deleted = models_delete(host, ModelsDeleteReq { model: AnyModel::Workspace(workspace) })
        .await
        .expect("delete");
    assert_eq!(deleted, id);
}
