use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{Settings, SettingsIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_settings(&self) -> Settings {
        let id = "default".to_string();

        if let Some(s) = self.find_optional::<Settings>(SettingsIden::Id, &id) {
            return s;
        };

        let settings = Settings {
            id,
            ..Default::default()
        };
        self.upsert(&settings, &UpdateSource::Core).expect("Failed to upsert settings")
    }

    pub fn upsert_settings(&self, settings: &Settings, source: &UpdateSource) -> Result<Settings> {
        self.upsert(settings, source)
    }
}
