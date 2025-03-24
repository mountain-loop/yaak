use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{Workspace, WorkspaceIden};
use crate::queries_legacy::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_workspace(&self, id: &str) -> Result<Workspace> {
        self.find_one(WorkspaceIden::Id, id)
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        self.find_all()
    }

    pub fn delete_workspace(&self, workspace: &Workspace, source: &UpdateSource) -> Result<Workspace> {
        self.delete_workspace_by_id(&workspace.id, source)
    }
    
    pub fn delete_workspace_by_id(&self, id: &str, source: &UpdateSource) -> Result<Workspace> {
        self.delete_all_http_responses_for_workspace(id, source)?;
        self.delete_by_id(id, source)
    }
    
    pub fn upsert_workspace(&self, w: &Workspace, source: &UpdateSource) -> Result<Workspace> {
        self.upsert(w, source)
    }
}
