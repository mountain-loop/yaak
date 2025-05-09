use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{
    EnvironmentIden, FolderIden, GrpcRequestIden, HttpRequestIden, WebsocketRequestIden, Workspace,
    WorkspaceIden,
};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
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
                    setting_validate_certificates: true,
                    ..Default::default()
                },
                &UpdateSource::Background,
            )?)
        }

        Ok(workspaces)
    }

    pub fn delete_workspace(
        &self,
        workspace: &Workspace,
        source: &UpdateSource,
    ) -> Result<Workspace> {
        for m in self.find_many(HttpRequestIden::WorkspaceId, &workspace.id, None)? {
            self.delete_http_request(&m, source)?;
        }

        for m in self.find_many(GrpcRequestIden::WorkspaceId, &workspace.id, None)? {
            self.delete_grpc_request(&m, source)?;
        }

        for m in self.find_many(WebsocketRequestIden::FolderId, &workspace.id, None)? {
            self.delete_websocket_request(&m, source)?;
        }

        for m in self.find_many(FolderIden::WorkspaceId, &workspace.id, None)? {
            self.delete_folder(&m, source)?;
        }

        for m in self.find_many(EnvironmentIden::WorkspaceId, &workspace.id, None)? {
            self.delete_environment(&m, source)?;
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
