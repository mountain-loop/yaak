use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{WorkspaceMeta, WorkspaceMetaIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_workspace_meta(&self, workspace_id: &str) -> Option<WorkspaceMeta> {
        self.find_optional(WorkspaceMetaIden::WorkspaceId, workspace_id)
    }

    pub fn list_workspace_metas(&self, workspace_id: &str) -> Result<Vec<WorkspaceMeta>> {
        let mut workspace_metas =
            self.find_many(WorkspaceMetaIden::WorkspaceId, workspace_id, None)?;

        if workspace_metas.is_empty() {
            let wm = WorkspaceMeta {
                workspace_id: workspace_id.to_string(),
                ..Default::default()
            };
            workspace_metas.push(self.upsert_workspace_meta(&wm, &UpdateSource::Background)?)
        }

        Ok(workspace_metas)
    }

    pub fn get_or_create_workspace_meta(
        &self,
        workspace_id: &str,
        source: &UpdateSource,
    ) -> Result<WorkspaceMeta> {
        let workspace_meta = self.get_workspace_meta(workspace_id);
        if let Some(workspace_meta) = workspace_meta {
            return Ok(workspace_meta);
        }

        let workspace_meta = WorkspaceMeta {
            workspace_id: workspace_id.to_string(),
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
