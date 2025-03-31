use crate::connection_or_tx::ConnectionOrTx;
use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{
    Folder, FolderIden, GrpcRequest, GrpcRequestIden, HttpRequest, HttpRequestIden,
    WebsocketRequest, WebsocketRequestIden,
};
use crate::util::UpdateSource;

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
}
