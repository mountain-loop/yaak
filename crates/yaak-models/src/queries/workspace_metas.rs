use crate::client_db::{ClientDb, WriteDb};
use crate::error::Result;
use crate::models::{WorkspaceMeta, WorkspaceMetaIden};
use crate::util::UpdateSource;
use log::info;

impl<'a> ClientDb<'a> {
    pub fn get_workspace_meta(&self, workspace_id: &str) -> Option<WorkspaceMeta> {
        self.find_optional(WorkspaceMetaIden::WorkspaceId, workspace_id)
    }

    pub fn list_workspace_metas(&self, workspace_id: &str) -> Result<Vec<WorkspaceMeta>> {
        self.find_many(WorkspaceMetaIden::WorkspaceId, workspace_id, None)
    }
}

impl<'a> WriteDb<'a> {
    pub fn ensure_workspace_meta(&self, workspace_id: &str) -> Result<WorkspaceMeta> {
        let workspace_meta = self.get_workspace_meta(workspace_id);
        if let Some(workspace_meta) = workspace_meta {
            return Ok(workspace_meta);
        }

        let workspace_meta =
            WorkspaceMeta { workspace_id: workspace_id.to_string(), ..Default::default() };

        info!("Creating WorkspaceMeta for {workspace_id}");

        self.upsert_workspace_meta(&workspace_meta, &UpdateSource::Background)
    }

    pub fn upsert_workspace_meta(
        &self,
        workspace_meta: &WorkspaceMeta,
        source: &UpdateSource,
    ) -> Result<WorkspaceMeta> {
        self.upsert(workspace_meta, source)
    }
}
