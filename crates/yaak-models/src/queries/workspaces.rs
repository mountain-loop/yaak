use super::merge_headers;
use crate::blob_manager::BlobManager;
use crate::client_db::{ClientDb, WriteDb};
use crate::error::Result;
use crate::models::{
    AnyModel, CookieJar, CookieJarIden, Environment, EnvironmentIden, Folder, FolderIden,
    GraphQlIntrospection, GraphQlIntrospectionIden, GrpcConnection, GrpcConnectionIden, GrpcEvent,
    GrpcEventIden, GrpcRequest, GrpcRequestIden, HttpRequest, HttpRequestHeader, HttpRequestIden,
    HttpResponse, HttpResponseEvent, HttpResponseEventIden, HttpResponseIden, ImportSource,
    ImportSourceIden, ModelVersion, ModelVersionIden, ResolvedHttpRequestSettings, ResolvedSetting,
    SyncState, SyncStateIden, WebsocketConnection, WebsocketConnectionIden, WebsocketEvent,
    WebsocketEventIden, WebsocketRequest, WebsocketRequestIden, Workspace, WorkspaceIden,
    WorkspaceMeta, WorkspaceMetaIden,
};
use crate::util::UpdateSource;
use log::warn;
use serde_json::Value;
use std::collections::BTreeMap;

impl<'a> ClientDb<'a> {
    pub fn get_workspace(&self, id: &str) -> Result<Workspace> {
        self.find_one(WorkspaceIden::Id, id)
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        self.find_all()
    }

    pub fn resolve_auth_for_workspace(
        &self,
        workspace: &Workspace,
    ) -> (Option<String>, BTreeMap<String, Value>, String) {
        (
            workspace.authentication_type.clone(),
            workspace.authentication.clone(),
            workspace.id.clone(),
        )
    }

    pub fn resolve_headers_for_workspace(&self, workspace: &Workspace) -> Vec<HttpRequestHeader> {
        merge_headers(default_headers(), workspace.headers.clone())
    }

    pub fn resolve_settings_for_workspace(
        &self,
        workspace: &Workspace,
    ) -> ResolvedHttpRequestSettings {
        ResolvedHttpRequestSettings {
            validate_certificates: ResolvedSetting::from_model(
                workspace.setting_validate_certificates,
                AnyModel::Workspace(workspace.clone()),
            ),
            follow_redirects: ResolvedSetting::from_model(
                workspace.setting_follow_redirects,
                AnyModel::Workspace(workspace.clone()),
            ),
            request_timeout: ResolvedSetting::from_model(
                workspace.setting_request_timeout,
                AnyModel::Workspace(workspace.clone()),
            ),
            request_message_size: ResolvedSetting::from_model(
                workspace.setting_request_message_size,
                AnyModel::Workspace(workspace.clone()),
            ),
            send_cookies: ResolvedSetting::from_model(
                workspace.setting_send_cookies,
                AnyModel::Workspace(workspace.clone()),
            ),
            store_cookies: ResolvedSetting::from_model(
                workspace.setting_store_cookies,
                AnyModel::Workspace(workspace.clone()),
            ),
            http_version: ResolvedSetting::from_model(
                workspace.setting_http_version,
                AnyModel::Workspace(workspace.clone()),
            ),
        }
    }
}

impl<'a> WriteDb<'a> {
    /// Delete a workspace and everything in it.
    ///
    /// Children are bulk-deleted with one statement per table and are NOT
    /// individually recorded in model_changes or emitted as events — the single
    /// workspace delete event implies the subtree (see [`ModelChangeEvent::Delete`]).
    /// This keeps huge workspaces (thousands of requests) fast and avoids
    /// flooding event consumers.
    pub fn delete_workspace(
        &self,
        workspace: &Workspace,
        source: &UpdateSource,
        blobs: &BlobManager,
    ) -> Result<Workspace> {
        let wid = workspace.id.as_str();

        // Collect response cleanup targets before their rows disappear. The actual
        // cleanup runs at the end: response bodies live on disk and in the blob DB,
        // which don't participate in this transaction, so removing them must wait
        // until every statement that could fail (and roll back the rows) is done.
        let responses = self.find_many::<HttpResponse>(HttpResponseIden::WorkspaceId, wid, None)?;

        self.delete_many_untracked::<HttpResponseEvent>(HttpResponseEventIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<HttpResponse>(HttpResponseIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<HttpRequest>(HttpRequestIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<GrpcEvent>(GrpcEventIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<GrpcConnection>(GrpcConnectionIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<GrpcRequest>(GrpcRequestIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<WebsocketEvent>(WebsocketEventIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<WebsocketConnection>(
            WebsocketConnectionIden::WorkspaceId,
            wid,
        )?;
        self.delete_many_untracked::<WebsocketRequest>(WebsocketRequestIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<GraphQlIntrospection>(
            GraphQlIntrospectionIden::WorkspaceId,
            wid,
        )?;
        self.delete_many_untracked::<Folder>(FolderIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<Environment>(EnvironmentIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<CookieJar>(CookieJarIden::WorkspaceId, wid)?;
        for import_source in self.list_import_sources(wid)? {
            self.delete_import_source_resources(&import_source.id)?;
        }
        self.delete_many_untracked::<ImportSource>(ImportSourceIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<ModelVersion>(ModelVersionIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<SyncState>(SyncStateIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<WorkspaceMeta>(WorkspaceMetaIden::WorkspaceId, wid)?;
        let deleted = self.delete(workspace, source)?;

        // Best-effort cleanup of response bodies (disk files and blob chunks).
        // Failures only orphan unreferenced data, and are logged.
        for m in responses {
            if let Some(p) = m.body_path {
                if let Err(e) = std::fs::remove_file(&p) {
                    warn!("Failed to delete response body file {p:?}: {e}");
                }
            }
            let pattern = format!("{}.%", m.id);
            if let Err(e) = blobs.with_tx(|b| b.delete_chunks_like(&pattern)) {
                warn!("Failed to delete blobs for response {}: {e}", m.id);
            }
        }

        Ok(deleted)
    }

    pub fn delete_workspace_by_id(
        &self,
        id: &str,
        source: &UpdateSource,
        blobs: &BlobManager,
    ) -> Result<Workspace> {
        let workspace = self.get_workspace(id)?;
        self.delete_workspace(&workspace, source, blobs)
    }

    pub fn upsert_workspace(&self, w: &Workspace, source: &UpdateSource) -> Result<Workspace> {
        self.upsert(w, source)
    }
}

/// Global default headers that are always sent with requests unless overridden.
/// These are prepended to the inheritance chain so workspace/folder/request headers
/// can override or disable them.
pub fn default_headers() -> Vec<HttpRequestHeader> {
    vec![
        HttpRequestHeader {
            name: "User-Agent".to_string(),
            value: "yaak".to_string(),
            ..Default::default()
        },
        HttpRequestHeader {
            name: "Accept".to_string(),
            value: "*/*".to_string(),
            ..Default::default()
        },
    ]
}

#[cfg(test)]
mod tests {
    use crate::init_in_memory;
    use crate::models::Workspace;
    use crate::util::UpdateSource;

    #[test]
    fn fresh_install_has_no_workspaces() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let workspaces = query_manager.connect().list_workspaces().expect("Failed to list");
        assert!(workspaces.is_empty());
    }

    #[test]
    fn default_workspace_carries_real_defaults() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let created = query_manager
            .with_tx(|tx| {
                tx.upsert_workspace(
                    &Workspace { name: "Yaak".to_string(), ..Default::default() },
                    &UpdateSource::Background,
                )
            })
            .expect("Failed to create workspace");
        let workspace = query_manager.connect().get_workspace(&created.id).expect("get");

        // A workspace built in Rust and never deserialized only gets these values
        // if `Workspace::default()` carries them. Asserted through the DB round
        // trip, since the column values are what the user lives with.
        assert!(workspace.setting_send_cookies, "setting_send_cookies");
        assert!(workspace.setting_store_cookies, "setting_store_cookies");
        assert!(workspace.setting_follow_redirects, "setting_follow_redirects");
        assert!(workspace.setting_validate_certificates, "setting_validate_certificates");
        assert_eq!(
            workspace.setting_request_message_size,
            crate::models::DEFAULT_REQUEST_MESSAGE_SIZE
        );
    }
}
