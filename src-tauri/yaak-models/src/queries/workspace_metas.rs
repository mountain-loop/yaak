use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{Workspace, WorkspaceMeta, WorkspaceMetaIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_workspace_meta(&self, workspace: &Workspace) -> Option<WorkspaceMeta> {
        self.find_optional(WorkspaceMetaIden::WorkspaceId, &workspace.id)
    }

    pub fn get_or_create_workspace_meta(
        &self,
        workspace: &Workspace,
        source: &UpdateSource,
    ) -> Result<WorkspaceMeta> {
        let workspace_meta = self.get_workspace_meta(workspace);
        if let Some(workspace_meta) = workspace_meta {
            return Ok(workspace_meta);
        }

        let workspace_meta = WorkspaceMeta {
            workspace_id: workspace.to_owned().id,
            ..Default::default()
        };

        self.upsert_workspace_meta(&workspace_meta, source)
    }

    pub fn upsert_workspace_meta(
        &self,
        workspace_meta: &WorkspaceMeta,
        source: &UpdateSource,
    ) -> Result<WorkspaceMeta> {
        self.upsert(workspace_meta, source)
    }
}
