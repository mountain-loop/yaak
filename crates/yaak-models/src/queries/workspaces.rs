use crate::blob_manager::BlobManager;
use crate::client_db::ClientDb;
use crate::error::Result;
use crate::models::{
    AnyModel, CookieJar, CookieJarIden, Environment, EnvironmentIden, Folder, FolderIden,
    GraphQlIntrospection, GraphQlIntrospectionIden, GrpcConnection, GrpcConnectionIden, GrpcEvent,
    GrpcEventIden, GrpcRequest, GrpcRequestIden, HttpRequest, HttpRequestHeader, HttpRequestIden,
    HttpResponse, HttpResponseEvent, HttpResponseEventIden, HttpResponseIden,
    ResolvedHttpRequestSettings, ResolvedSetting, SyncState, SyncStateIden, WebsocketConnection,
    WebsocketConnectionIden, WebsocketEvent, WebsocketEventIden, WebsocketRequest,
    WebsocketRequestIden, Workspace, WorkspaceIden, WorkspaceMeta, WorkspaceMetaIden,
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
        let mut workspaces = self.find_all()?;

        if workspaces.is_empty() {
            workspaces.push(self.upsert_workspace(
                &Workspace {
                    name: "Yaak".to_string(),
                    setting_follow_redirects: true,
                    setting_request_message_size: crate::models::DEFAULT_REQUEST_MESSAGE_SIZE,
                    setting_validate_certificates: true,
                    ..Default::default()
                },
                &UpdateSource::Background,
            )?)
        }

        Ok(workspaces)
    }

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

        // Response bodies live on disk and in the blob DB; clean both up before
        // dropping the rows
        let blob_ctx = blobs.connect();
        for m in self.find_many::<HttpResponse>(HttpResponseIden::WorkspaceId, wid, None)? {
            if let Some(p) = m.body_path {
                if let Err(e) = std::fs::remove_file(&p) {
                    warn!("Failed to delete response body file {p:?}: {e}");
                }
            }
            if let Err(e) = blob_ctx.delete_chunks_like(&format!("{}.%", m.id)) {
                warn!("Failed to delete blobs for response {}: {e}", m.id);
            }
        }

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
        self.delete_many_untracked::<SyncState>(SyncStateIden::WorkspaceId, wid)?;
        self.delete_many_untracked::<WorkspaceMeta>(WorkspaceMetaIden::WorkspaceId, wid)?;

        self.delete(workspace, source)
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
        let mut headers = default_headers();
        headers.extend(workspace.headers.clone());
        headers
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
        }
    }
}

/// Global default headers that are always sent with requests unless overridden.
/// These are prepended to the inheritance chain so workspace/folder/request headers
/// can override or disable them.
pub fn default_headers() -> Vec<HttpRequestHeader> {
    vec![
        HttpRequestHeader {
            enabled: true,
            name: "User-Agent".to_string(),
            value: "yaak".to_string(),
            id: None,
        },
        HttpRequestHeader {
            enabled: true,
            name: "Accept".to_string(),
            value: "*/*".to_string(),
            id: None,
        },
    ]
}
