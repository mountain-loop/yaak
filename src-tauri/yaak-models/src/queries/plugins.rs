use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{Plugin, PluginIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_plugin(&self, id: &str) -> Result<Plugin> {
        self.find_one(PluginIden::Id, id)
    }

    pub fn get_plugin_by_directory(&self, directory: &str) -> Option<Plugin> {
        self.find_optional(PluginIden::Directory, directory)
    }

    pub fn list_plugins(&self) -> Result<Vec<Plugin>> {
        self.find_all()
    }

    pub fn delete_plugin(&self, plugin: &Plugin, source: &UpdateSource) -> Result<Plugin> {
        self.delete(plugin, source)
    }

    pub fn delete_plugin_by_id(&self, id: &str, source: &UpdateSource) -> Result<Plugin> {
        let plugin = self.get_plugin(id)?;
        self.delete_plugin(&plugin, source)
    }

    pub fn upsert_plugin(&self, plugin: &Plugin, source: &UpdateSource) -> Result<Plugin> {
        self.upsert(plugin, source)
    }
}
