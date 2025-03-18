use crate::events::{
    FormInputBase, FormInputSecureText, FormInputTemplateFunction, PluginWindowContext,
    TemplateFunction, TemplateFunctionArg,
};
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;
use yaak_crypto::manager::EncryptionManager;
use yaak_templates::error::Error::RenderError;
use yaak_templates::error::Result;

pub(crate) fn template_function_secure() -> TemplateFunction {
    TemplateFunction {
        name: "secure".to_string(),
        description: Some("Securely store encrypted values".to_string()),
        aliases: None,
        args: vec![TemplateFunctionArg::Extra(
            FormInputTemplateFunction::SecureText(FormInputSecureText {
                base: FormInputBase {
                    name: "value".to_string(),
                    hidden: None,
                    optional: None,
                    label: Some("Value".to_string()),
                    hide_label: None,
                    default_value: None,
                    disabled: None,
                },
            }),
        )],
    }
}

pub(crate) async fn template_function_secure_run<R: Runtime>(
    app_handle: &AppHandle<R>,
    args: HashMap<String, String>,
    window_context: &PluginWindowContext,
) -> Result<String> {
    match window_context.clone() {
        PluginWindowContext::Label {
            workspace_id: Some(wid),
            ..
        } => {
            let value = args.get("value").map(|v| v.to_owned()).unwrap_or_default();
            if value.is_empty() {
                return Ok(value);
            }

            let value = match value.strip_prefix("YENC_") {
                None => {
                    return Err(RenderError("Could not decrypt non-encrypted value".to_string()))
                }
                Some(v) => v,
            };

            let value = BASE64_STANDARD.decode(&value).unwrap();
            let crypto_manager = &*app_handle.state::<Mutex<EncryptionManager>>();
            let crypto_manager = crypto_manager.lock().await;
            let r = crypto_manager
                .decrypt(&wid, value.as_slice())
                .await
                .map_err(|e| RenderError(e.to_string()))?;
            let r = String::from_utf8(r).map_err(|e| RenderError(e.to_string()))?;
            Ok(r)
        }
        _ => Err(RenderError("workspace_id missing from window context".to_string())),
    }
}

pub(crate) async fn template_function_secure_transform_arg<R: Runtime>(
    app_handle: &AppHandle<R>,
    window_context: &PluginWindowContext,
    arg_name: &str,
    arg_value: &str,
) -> Result<String> {
    if arg_name != "value" {
        return Ok(arg_value.to_string());
    }

    match window_context.clone() {
        PluginWindowContext::Label {
            workspace_id: Some(wid),
            ..
        } => {
            if arg_value.is_empty() {
                return Ok("".to_string())
            }

            if arg_value.starts_with("YENC_") {
                // Already encrypted, so do nothing
                return Ok(arg_value.to_string());
            }

            let crypto_manager = &*app_handle.state::<Mutex<EncryptionManager>>();
            let crypto_manager = crypto_manager.lock().await;
            let r = crypto_manager
                .encrypt(&wid, arg_value.as_bytes())
                .await
                .map_err(|e| RenderError(e.to_string()))?;
            let r = BASE64_STANDARD.encode(r);
            Ok(format!("YENC_{}", r))
        }
        _ => Err(RenderError("workspace_id missing from window context".to_string())),
    }
}
