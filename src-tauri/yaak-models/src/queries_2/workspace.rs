use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{Workspace, WorkspaceIden};

impl<'a> DbContext<'a> {
    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        self.find_all(WorkspaceIden::Table)
    }

    pub fn get_workspace(&self, id: &str) -> Result<Workspace> {
        self.find_one(WorkspaceIden::Table, WorkspaceIden::Id, id)
    }
}
