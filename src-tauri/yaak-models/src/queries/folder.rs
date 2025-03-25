use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{
    Folder, FolderIden, GrpcRequest, GrpcRequestIden, HttpRequest, HttpRequestIden,
    WebsocketRequest, WebsocketRequestIden,
};
use crate::queries_legacy::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_folder(&self, id: &str) -> Result<Folder> {
        self.find_one(FolderIden::Id, id)
    }

    pub fn list_folders(&self, workspace_id: &str) -> Result<Vec<Folder>> {
        self.find_many(FolderIden::WorkspaceId, workspace_id, None)
    }

    pub fn delete_folder(&self, folder: &Folder, source: &UpdateSource) -> Result<Folder> {
        for folder in self.find_many::<Folder>(FolderIden::FolderId, &folder.id, None)? {
            self.delete_folder(&folder, source)?;
        }
        for request in self.find_many::<HttpRequest>(HttpRequestIden::FolderId, &folder.id, None)? {
            self.delete_http_request(&request, source)?;
        }
        for request in self.find_many::<GrpcRequest>(GrpcRequestIden::FolderId, &folder.id, None)? {
            self.delete_grpc_request(&request, source)?;
        }
        for request in
            self.find_many::<WebsocketRequest>(WebsocketRequestIden::FolderId, &folder.id, None)?
        {
            self.delete_websocket_request(&request, source)?;
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
        let workspace_id = src_folder.workspace_id.as_str();

        let http_requests = self
            .find_many::<HttpRequest>(HttpRequestIden::WorkspaceId, workspace_id, None)?
            .into_iter()
            .filter(|m| m.folder_id.as_ref() == Some(&src_folder.id));

        let grpc_requests = self
            .find_many::<GrpcRequest>(GrpcRequestIden::WorkspaceId, workspace_id, None)?
            .into_iter()
            .filter(|m| m.folder_id.as_ref() == Some(&src_folder.id));

        let folders = self
            .find_many::<Folder>(FolderIden::WorkspaceId, workspace_id, None)?
            .into_iter()
            .filter(|m| m.folder_id.as_ref() == Some(&src_folder.id));

        let new_folder = self.upsert_folder(
            &Folder {
                id: "".into(),
                sort_priority: src_folder.sort_priority + 0.001,
                ..src_folder.clone()
            },
            source,
        )?;

        for m in http_requests {
            self.upsert_http_request(
                &HttpRequest {
                    id: "".into(),
                    folder_id: Some(new_folder.id.clone()),
                    sort_priority: m.sort_priority + 0.001,
                    ..m
                },
                source,
            )?;
        }
        for m in grpc_requests {
            self.upsert_grpc_request(
                &GrpcRequest {
                    id: "".into(),
                    folder_id: Some(new_folder.id.clone()),
                    sort_priority: m.sort_priority + 0.001,
                    ..m
                },
                source,
            )?;
        }
        for m in folders {
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
}
