use crate::client_db::{ClientDb, WriteDb};
use crate::error::Result;
use crate::models::{CookieJar, CookieJarIden};
use crate::util::UpdateSource;

impl<'a> ClientDb<'a> {
    pub fn get_cookie_jar(&self, id: &str) -> Result<CookieJar> {
        self.find_one(CookieJarIden::Id, id)
    }

    pub fn list_cookie_jars(&self, workspace_id: &str) -> Result<Vec<CookieJar>> {
        self.find_many(CookieJarIden::WorkspaceId, workspace_id, None)
    }
}

impl<'a> WriteDb<'a> {
    /// A workspace with no cookie jar gets a default one.
    pub fn ensure_default_cookie_jar(&self, workspace_id: &str) -> Result<()> {
        if self.list_cookie_jars(workspace_id)?.is_empty() {
            let jar = CookieJar {
                name: "Default".to_string(),
                workspace_id: workspace_id.to_string(),
                ..Default::default()
            };
            self.upsert_cookie_jar(&jar, &UpdateSource::Background)?;
        }
        Ok(())
    }

    pub fn delete_cookie_jar(
        &self,
        cookie_jar: &CookieJar,
        source: &UpdateSource,
    ) -> Result<CookieJar> {
        self.delete(cookie_jar, source)
    }

    pub fn delete_cookie_jar_by_id(&self, id: &str, source: &UpdateSource) -> Result<CookieJar> {
        let cookie_jar = self.get_cookie_jar(id)?;
        self.delete_cookie_jar(&cookie_jar, source)
    }

    pub fn upsert_cookie_jar(
        &self,
        cookie_jar: &CookieJar,
        source: &UpdateSource,
    ) -> Result<CookieJar> {
        self.upsert(cookie_jar, source)
    }
}
