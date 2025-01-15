use std::collections::HashMap;
use tauri::{AppHandle, Manager, Runtime};
use yaak_plugins::events::{FormInput, RenderPurpose, WindowContext};
use yaak_plugins::manager::PluginManager;
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
    async fn run(&self, fn_name: &str, args: HashMap<String, String>) -> Result<String, String> {
        let window_context = self.window_context.to_owned();
        // The beta named the function `Response` but was changed in stable.
        // Keep this here for a while because there's no easy way to migrate
        let fn_name = if fn_name == "Response" { "response" } else { fn_name };

        let function = self
            .plugin_manager
            .get_template_functions_with_context(window_context.to_owned())
            .await
            .map_err(|e| e.to_string())?
            .iter()
            .flat_map(|f| f.functions.clone())
            .find(|f| f.name == fn_name)
            .ok_or("")?;

        let mut args_with_defaults = args.clone();

        // Fill in default values for all args
        for a_def in function.args {
            let base = match a_def {
                FormInput::Text(a) => a.base,
                FormInput::Select(a) => a.base,
                FormInput::Checkbox(a) => a.base,
                FormInput::File(a) => a.base,
                FormInput::HttpRequest(a) => a.base,
            };
            if let None = args_with_defaults.get(base.name.as_str()) {
                args_with_defaults.insert(base.name, base.default_value.unwrap_or_default());
            }
        }

        let resp = self
            .plugin_manager
            .call_template_function(
                window_context,
                fn_name,
                args_with_defaults,
                self.render_purpose.to_owned(),
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(resp.unwrap_or_default())
    }
}
