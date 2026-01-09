use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{CookieJar, CookieJarIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_cookie_jar(&self, id: &str) -> Result<CookieJar> {
        self.find_one(CookieJarIden::Id, id)
    }

    pub fn list_cookie_jars(&self, workspace_id: &str) -> Result<Vec<CookieJar>> {
        let mut cookie_jars = self.find_many(CookieJarIden::WorkspaceId, workspace_id, None)?;

        if cookie_jars.is_empty() {
            let jar = CookieJar {
                name: "Default".to_string(),
                workspace_id: workspace_id.to_string(),
                ..Default::default()
            };
            cookie_jars.push(self.upsert_cookie_jar(&jar, &UpdateSource::Background)?);
        }

        Ok(cookie_jars)
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
