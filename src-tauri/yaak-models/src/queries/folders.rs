use crate::connection_or_tx::ConnectionOrTx;
use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{Environment, EnvironmentIden, Folder, FolderIden, GrpcRequest, GrpcRequestIden, HttpRequest, HttpRequestHeader, HttpRequestIden, WebsocketRequest, WebsocketRequestIden};
use crate::util::UpdateSource;
use serde_json::Value;
use std::collections::BTreeMap;

impl<'a> DbContext<'a> {
    pub fn get_folder(&self, id: &str) -> Result<Folder> {
        self.find_one(FolderIden::Id, id)
    }

    pub fn list_folders(&self, workspace_id: &str) -> Result<Vec<Folder>> {
        self.find_many(FolderIden::WorkspaceId, workspace_id, None)
    }

    pub fn delete_folder(&self, folder: &Folder, source: &UpdateSource) -> Result<Folder> {
        match self.conn {
            ConnectionOrTx::Connection(_) => {}
            ConnectionOrTx::Transaction(_) => {}
        }

        let fid = &folder.id;
        for m in self.find_many::<HttpRequest>(HttpRequestIden::FolderId, fid, None)? {
            self.delete_http_request(&m, source)?;
        }

        for m in self.find_many::<GrpcRequest>(GrpcRequestIden::FolderId, fid, None)? {
            self.delete_grpc_request(&m, source)?;
        }

        for m in self.find_many::<WebsocketRequest>(WebsocketRequestIden::FolderId, fid, None)? {
            self.delete_websocket_request(&m, source)?;
        }

        for e in self.find_many(EnvironmentIden::ParentId, fid, None)? {
            self.delete_environment(&e, source)?;
        }

        // Recurse down into child folders
        for folder in self.find_many::<Folder>(FolderIden::FolderId, fid, None)? {
            self.delete_folder(&folder, source)?;
        }

        self.delete(folder, source)
    }

    pub fn delete_folder_by_id(&self, id: &str, source: &UpdateSource) -> Result<Folder> {
        let folder = self.get_folder(id)?;
        self.delete_folder(&folder, source)
    }

    pub fn upsert_folder(&self, folder: &Folder, source: &UpdateSource) -> Result<Folder> {
        self.upsert(folder, source)
    }

    pub fn duplicate_folder(&self, src_folder: &Folder, source: &UpdateSource) -> Result<Folder> {
        let fid = &src_folder.id;

        let new_folder = self.upsert_folder(
            &Folder {
                id: "".into(),
                sort_priority: src_folder.sort_priority + 0.001,
                ..src_folder.clone()
            },
            source,
        )?;

        for m in self.find_many::<HttpRequest>(HttpRequestIden::FolderId, fid, None)? {
            self.upsert_http_request(
                &HttpRequest {
                    id: "".into(),
                    folder_id: Some(new_folder.id.clone()),
                    ..m
                },
                source,
            )?;
        }

        for m in self.find_many::<WebsocketRequest>(WebsocketRequestIden::FolderId, fid, None)? {
            self.upsert_websocket_request(
                &WebsocketRequest {
                    id: "".into(),
                    folder_id: Some(new_folder.id.clone()),
                    ..m
                },
                source,
            )?;
        }

        for m in self.find_many::<GrpcRequest>(GrpcRequestIden::FolderId, fid, None)? {
            self.upsert_grpc_request(
                &GrpcRequest {
                    id: "".into(),
                    folder_id: Some(new_folder.id.clone()),
                    ..m
                },
                source,
            )?;
        }

        for m in self.find_many::<Environment>(EnvironmentIden::ParentId, fid, None)? {
            self.upsert_environment(
                &Environment {
                    id: "".into(),
                    parent_id: Some(new_folder.id.clone()),
                    ..m
                },
                source,
            )?;
        }

        for m in self.find_many::<Folder>(FolderIden::FolderId, fid, None)? {
            // Recurse down
            self.duplicate_folder(
                &Folder {
                    folder_id: Some(new_folder.id.clone()),
                    ..m
                },
                source,
            )?;
        }

        Ok(new_folder)
    }

    pub fn resolve_auth_for_folder(
        &self,
        folder: &Folder,
    ) -> Result<(Option<String>, BTreeMap<String, Value>, String)> {
        if let Some(at) = folder.authentication_type.clone() {
            return Ok((Some(at), folder.authentication.clone(), folder.id.clone()));
        }

        if let Some(folder_id) = folder.folder_id.clone() {
            let folder = self.get_folder(&folder_id)?;
            return self.resolve_auth_for_folder(&folder);
        }

        let workspace = self.get_workspace(&folder.workspace_id)?;
        Ok(self.resolve_auth_for_workspace(&workspace))
    }

    pub fn resolve_headers_for_folder(&self, folder: &Folder) -> Result<Vec<HttpRequestHeader>> {
        let mut headers = Vec::new();

        if let Some(folder_id) = folder.folder_id.clone() {
            let parent_folder = self.get_folder(&folder_id)?;
            let mut folder_headers = self.resolve_headers_for_folder(&parent_folder)?;
            // NOTE: Add parent headers first, so overrides are logical
            headers.append(&mut folder_headers);
        } else {
            let workspace = self.get_workspace(&folder.workspace_id)?;
            let mut workspace_headers = self.resolve_headers_for_workspace(&workspace);
            headers.append(&mut workspace_headers);
        }

        headers.append(&mut folder.headers.clone());

        Ok(headers)
    }
}
