//! A host that is nothing but the trait: a temp database, a fixed client id,
//! a fixed session. It exists to prove that the handlers really do run without
//! a desktop around them, and that the client's identity reaches the writes.
//!
//! It implements `Host` and not `PluginHost`, which is the point: there is no
//! Node runtime here, and the commands exercised below never needed one. A
//! handler that reaches for plugins would not compile against this host.

use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use yaak_commands::Host;
use yaak_commands::models::{
    cmd_default_headers, cmd_get_workspace_meta, models_delete, models_upsert,
};
use yaak_core::WorkspaceContext;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{AnyModel, Workspace};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{ModelPayload, UpdateSource};
use yaak_rpc_schema::{
    CmdDefaultHeadersReq, CmdGetWorkspaceMetaReq, ModelsDeleteReq, ModelsUpsertReq,
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

    // Deletes run through spawn_blocking and a transaction; make sure that
    // path also works off a plain tokio runtime.
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
