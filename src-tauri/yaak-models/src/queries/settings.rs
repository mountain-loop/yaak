use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{Settings, SettingsIden};
use crate::queries_legacy::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_or_create_settings(&self, source: &UpdateSource) -> Result<Settings> {
        let id = "default";
        if let Some(s) = self.find_optional::<Settings>(SettingsIden::Id, id)? {
            return Ok(s);
        };

        self.upsert(
            &Settings {
                id: id.to_string(),
                ..Default::default()
            },
            source,
        )
    }

    pub fn upsert_settings(&self, settings: &Settings, source: &UpdateSource) -> Result<Settings> {
        self.upsert(settings, source)
    }
}
