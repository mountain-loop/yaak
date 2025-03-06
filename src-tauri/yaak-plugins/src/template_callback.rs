use crate::events::{RenderPurpose, WindowContext};
use crate::manager::PluginManager;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Runtime};
use yaak_templates::error::Result;
use yaak_templates::TemplateCallback;

#[derive(Clone)]
pub struct PluginTemplateCallback {
    plugin_manager: PluginManager,
    window_context: WindowContext,
    render_purpose: RenderPurpose,
}

impl PluginTemplateCallback {
    pub fn new<R: Runtime>(
        app_handle: &AppHandle<R>,
        window_context: &WindowContext,
        render_purpose: RenderPurpose,
    ) -> PluginTemplateCallback {
        let plugin_manager = &*app_handle.state::<PluginManager>();
        PluginTemplateCallback {
            plugin_manager: plugin_manager.to_owned(),
            window_context: window_context.to_owned(),
            render_purpose,
        }
    }
}

impl TemplateCallback for PluginTemplateCallback {
    async fn run(&self, fn_name: &str, args: HashMap<String, String>) -> Result<String> {
        // The beta named the function `Response` but was changed in stable.
        // Keep this here for a while because there's no easy way to migrate
        let fn_name = if fn_name == "Response" { "response" } else { fn_name };

        let resp = self
            .plugin_manager
            .call_template_function(
                &self.window_context,
                fn_name,
                args,
                self.render_purpose.to_owned(),
            )
            .await?;
        Ok(resp)
    }
}
