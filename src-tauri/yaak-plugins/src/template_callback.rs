use crate::events::{PluginWindowContext, RenderPurpose};
use crate::manager::PluginManager;
use crate::native_template_functions::{
    template_function_secure_run, template_function_secure_transform_arg,
};
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Runtime};
use yaak_templates::error::Result;
use yaak_templates::TemplateCallback;

#[derive(Clone)]
pub struct PluginTemplateCallback<R: Runtime> {
    app_handle: AppHandle<R>,
    render_purpose: RenderPurpose,
    window_context: PluginWindowContext,
}

impl<R: Runtime> PluginTemplateCallback<R> {
    pub fn new(
        app_handle: &AppHandle<R>,
        window_context: &PluginWindowContext,
        render_purpose: RenderPurpose,
    ) -> PluginTemplateCallback<R> {
        PluginTemplateCallback {
            render_purpose,
            app_handle: app_handle.to_owned(),
            window_context: window_context.to_owned(),
        }
    }
}

impl<R: Runtime> TemplateCallback for PluginTemplateCallback<R> {
    async fn run(&self, fn_name: &str, args: HashMap<String, serde_json::Value>) -> Result<String> {
        // The beta named the function `Response` but was changed in stable.
        // Keep this here for a while because there's no easy way to migrate
        let fn_name = if fn_name == "Response" { "response" } else { fn_name };

        if fn_name == "secure" {
            return template_function_secure_run(&self.app_handle, args, &self.window_context);
        }

        let plugin_manager = &*self.app_handle.state::<PluginManager>();
        let resp = plugin_manager
            .call_template_function(
                &self.window_context,
                fn_name,
                args,
                self.render_purpose.to_owned(),
            )
            .await?;
        Ok(resp)
    }

    fn transform_arg(
        &self,
        fn_name: &str,
        arg_name: &str,
        arg_value: &str,
    ) -> Result<String> {
        if fn_name == "secure" {
            return template_function_secure_transform_arg(
                &self.app_handle,
                &self.window_context,
                arg_name,
                arg_value,
            );
        }

        Ok(arg_value.to_string())
    }
}
