use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{Settings, SettingsIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_or_create_settings(&self, source: &UpdateSource) -> Settings {
        let id = "default".to_string();

        if let Some(s) = self.find_optional::<Settings>(SettingsIden::Id, &id) {
            return s;
        };

        self.upsert(
            &Settings {
                id,
                ..Default::default()
            },
            source,
        )
        .expect("Failed to upsert settings")
    }

    pub fn upsert_settings(&self, settings: &Settings, source: &UpdateSource) -> Result<Settings> {
        self.upsert(settings, source)
    }
}
