use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{
    Folder, FolderIden, GrpcRequest, GrpcRequestIden, HttpRequest, HttpRequestIden,
    WebsocketRequest, WebsocketRequestIden, Workspace, WorkspaceIden,
};
use crate::queries_legacy::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_workspace(&self, id: &str) -> Result<Workspace> {
        self.find_one(WorkspaceIden::Id, id)
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        self.find_all()
    }

    pub fn delete_workspace(
        &self,
        workspace: &Workspace,
        source: &UpdateSource,
    ) -> Result<Workspace> {
        for folder in self.find_many::<Folder>(FolderIden::WorkspaceId, &workspace.id, None)? {
            self.delete_folder(&folder, source)?;
        }
        for request in
            self.find_many::<HttpRequest>(HttpRequestIden::WorkspaceId, &workspace.id, None)?
        {
            self.delete_http_request(&request, source)?;
        }
        for request in
            self.find_many::<GrpcRequest>(GrpcRequestIden::WorkspaceId, &workspace.id, None)?
        {
            self.delete_grpc_request(&request, source)?;
        }
        for request in
            self.find_many::<WebsocketRequest>(WebsocketRequestIden::FolderId, &workspace.id, None)?
        {
            self.delete_websocket_request(&request, source)?;
        }
        self.delete(workspace, source)
    }

    pub fn delete_workspace_by_id(&self, id: &str, source: &UpdateSource) -> Result<Workspace> {
        let workspace = self.get_workspace(id)?;
        self.delete_workspace(&workspace, source)
    }

    pub fn upsert_workspace(&self, w: &Workspace, source: &UpdateSource) -> Result<Workspace> {
        self.upsert(w, source)
    }
}
