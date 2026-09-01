use crate::client_db::ClientDb;
use crate::error::Result;
use crate::models::{ImportSource, ImportSourceIden};
use crate::util::UpdateSource;

impl<'a> ClientDb<'a> {
    pub fn get_import_source(&self, id: &str) -> Result<ImportSource> {
        self.find_one(ImportSourceIden::Id, id)
    }

    pub fn list_import_sources(&self, workspace_id: &str) -> Result<Vec<ImportSource>> {
        self.find_many(ImportSourceIden::WorkspaceId, workspace_id, None)
    }

    pub fn list_import_sources_by_origin(&self, origin: &str) -> Result<Vec<ImportSource>> {
        self.find_many(ImportSourceIden::Origin, origin, None)
    }

    pub fn find_import_source(
        &self,
        workspace_id: &str,
        importer: &str,
        origin: &str,
    ) -> Result<Option<ImportSource>> {
        let sources = self.list_import_sources(workspace_id)?;
        Ok(sources.into_iter().find(|s| s.importer == importer && s.origin == origin))
    }

    pub fn upsert_import_source(
        &self,
        import_source: &ImportSource,
        source: &UpdateSource,
    ) -> Result<ImportSource> {
        self.upsert(import_source, source)
    }

    pub fn delete_import_source(
        &self,
        import_source: &ImportSource,
        source: &UpdateSource,
    ) -> Result<ImportSource> {
        self.delete_import_source_resources(&import_source.id)?;
        self.delete(import_source, source)
    }
}
