//! Plugin template callback implementation.
//!
//! This provides a TemplateCallback implementation that delegates to plugins
//! for template function execution.

use crate::events::{JsonPrimitive, PluginContext, RenderPurpose};
use crate::manager::PluginManager;
use crate::native_template_functions::{
    template_function_keychain_run, template_function_secure_run,
    template_function_secure_transform_arg,
};
use std::collections::HashMap;
use std::sync::Arc;
use yaak_crypto::manager::EncryptionManager;
use yaak_templates::TemplateCallback;
use yaak_templates::error::Result;

#[derive(Clone)]
pub struct PluginTemplateCallback {
    plugin_manager: Arc<PluginManager>,
    encryption_manager: Arc<EncryptionManager>,
    render_purpose: RenderPurpose,
    plugin_context: PluginContext,
}

impl PluginTemplateCallback {
    pub fn new(
        plugin_manager: Arc<PluginManager>,
        encryption_manager: Arc<EncryptionManager>,
        plugin_context: &PluginContext,
        render_purpose: RenderPurpose,
    ) -> PluginTemplateCallback {
        PluginTemplateCallback {
            plugin_manager,
            encryption_manager,
            render_purpose,
            plugin_context: plugin_context.to_owned(),
        }
    }
}

impl TemplateCallback for PluginTemplateCallback {
    async fn run(&self, fn_name: &str, args: HashMap<String, serde_json::Value>) -> Result<String> {
        // The beta named the function `Response` but was changed in stable.
        // Keep this here for a while because there's no easy way to migrate
        let fn_name = if fn_name == "Response" { "response" } else { fn_name };

        if fn_name == "secure" {
            return template_function_secure_run(&self.encryption_manager, args, &self.plugin_context);
        } else if fn_name == "keychain" || fn_name == "keyring" {
            return template_function_keychain_run(args);
        }

        let mut primitive_args = HashMap::new();
        for (key, value) in args {
            primitive_args.insert(key, JsonPrimitive::from(value));
        }

        let resp = self.plugin_manager
            .call_template_function(
                &self.plugin_context,
                fn_name,
                primitive_args,
                self.render_purpose.to_owned(),
            )
            .await?;
        Ok(resp)
    }

    fn transform_arg(&self, fn_name: &str, arg_name: &str, arg_value: &str) -> Result<String> {
        if fn_name == "secure" {
            return template_function_secure_transform_arg(
                &self.encryption_manager,
                &self.plugin_context,
                arg_name,
                arg_value,
            );
        }

        Ok(arg_value.to_string())
    }
}
