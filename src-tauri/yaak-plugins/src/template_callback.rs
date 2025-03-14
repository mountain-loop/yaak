use crate::events::{PluginWindowContext, RenderPurpose};
use crate::manager::PluginManager;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;
use yaak_crypto::manager::EncryptionManager;
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
    async fn run(&self, fn_name: &str, args: HashMap<String, String>) -> Result<String> {
        // The beta named the function `Response` but was changed in stable.
        // Keep this here for a while because there's no easy way to migrate
        let fn_name = if fn_name == "Response" { "response" } else { fn_name };

        if fn_name == "secure" {
            return match self.window_context.clone() {
                PluginWindowContext::Label {
                    workspace_id: Some(wid),
                    ..
                } => {
                    let value = args.get("value").map(|v| v.to_owned()).unwrap_or_default();
                    let crypto_manager = &*self.app_handle.state::<Mutex<EncryptionManager<R>>>();
                    let crypto_manager = crypto_manager.lock().await;
                    let r = crypto_manager
                        .decrypt(&wid, value.into_bytes())
                        .await
                        .map_err(|e| yaak_templates::error::Error::RenderError(e.to_string()))?;
                    let r = String::from_utf8(r)
                        .map_err(|e| yaak_templates::error::Error::RenderError(e.to_string()))?;
                    Ok(r)
                }
                _ => Err(yaak_templates::error::Error::RenderError(
                    "workspace_id missing from window context".into(),
                )),
            };
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
}
