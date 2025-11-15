use crate::events::{
    FormInput, FormInputBase, FormInputText, PluginContext, RenderPurpose, TemplateFunction,
    TemplateFunctionArg, TemplateFunctionPreviewType,
};
use crate::template_callback::PluginTemplateCallback;
use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use keyring::Error::NoEntry;
use log::{debug, info};
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};
use yaak_crypto::manager::EncryptionManagerExt;
use yaak_templates::error::Error::RenderError;
use yaak_templates::error::Result;
use yaak_templates::{FnArg, Parser, Token, Tokens, Val, transform_args};

pub(crate) fn template_function_secure() -> TemplateFunction {
    TemplateFunction {
        name: "secure".to_string(),
        preview_type: Some(TemplateFunctionPreviewType::None),
        description: Some("Securely store encrypted text".to_string()),
        aliases: None,
        args: vec![TemplateFunctionArg::FormInput(FormInput::Text(
            FormInputText {
                multi_line: Some(true),
                password: Some(true),
                base: FormInputBase {
                    name: "value".to_string(),
                    label: Some("Value".to_string()),
                    ..Default::default()
                },
                ..Default::default()
            },
        ))],
    }
}

pub(crate) fn template_function_keyring() -> TemplateFunction {
    TemplateFunction {
        name: "keychain".to_string(),
        preview_type: Some(TemplateFunctionPreviewType::Live),
        description: Some("Get a password from the OS keychain or keyring".to_string()),
        aliases: Some(vec!["keyring".to_string()]),
        args: vec![
            TemplateFunctionArg::FormInput(FormInput::Text(FormInputText {
                base: FormInputBase {
                    name: "service".to_string(),
                    label: Some("Service".to_string()),
                    description: Some("App or URL for the password".to_string()),
                    ..Default::default()
                },
                ..Default::default()
            })),
            TemplateFunctionArg::FormInput(FormInput::Text(FormInputText {
                base: FormInputBase {
                    name: "account".to_string(),
                    label: Some("Account".to_string()),
                    description: Some("Username or email address".to_string()),
                    ..Default::default()
                },
                ..Default::default()
            })),
        ],
    }
}

pub fn template_function_secure_run<R: Runtime>(
    app_handle: &AppHandle<R>,
    args: HashMap<String, serde_json::Value>,
    plugin_context: &PluginContext,
) -> Result<String> {
    match plugin_context.workspace_id.clone() {
        Some(wid) => {
            let value = args.get("value").map(|v| v.to_owned()).unwrap_or_default();
            let value = match value {
                serde_json::Value::String(s) => s,
                _ => return Ok("".to_string()),
            };

            if value.is_empty() {
                return Ok("".to_string());
            }

            let value = match value.strip_prefix("YENC_") {
                None => {
                    return Err(RenderError("Could not decrypt non-encrypted value".to_string()));
                }
                Some(v) => v,
            };

            let value = BASE64_STANDARD.decode(&value).unwrap();
            let r = match app_handle.crypto().decrypt(&wid, value.as_slice()) {
                Ok(r) => Ok(r),
                Err(e) => Err(RenderError(e.to_string())),
            }?;
            let r = String::from_utf8(r).map_err(|e| RenderError(e.to_string()))?;
            Ok(r)
        }
        _ => Err(RenderError("workspace_id missing from plugin context".to_string())),
    }
}

pub fn template_function_secure_transform_arg<R: Runtime>(
    app_handle: &AppHandle<R>,
    plugin_context: &PluginContext,
    arg_name: &str,
    arg_value: &str,
) -> Result<String> {
    if arg_name != "value" {
        return Ok(arg_value.to_string());
    }

    match plugin_context.workspace_id.clone() {
        Some(wid) => {
            if arg_value.is_empty() {
                return Ok("".to_string());
            }

            if arg_value.starts_with("YENC_") {
                // Already encrypted, so do nothing
                return Ok(arg_value.to_string());
            }

            let r = app_handle
                .crypto()
                .encrypt(&wid, arg_value.as_bytes())
                .map_err(|e| RenderError(e.to_string()))?;
            let r = BASE64_STANDARD.encode(r);
            Ok(format!("YENC_{}", r))
        }
        _ => Err(RenderError("workspace_id missing from plugin context".to_string())),
    }
}

pub fn decrypt_secure_template_function<R: Runtime>(
    app_handle: &AppHandle<R>,
    plugin_context: &PluginContext,
    template: &str,
) -> Result<String> {
    let mut parsed = Parser::new(template).parse()?;
    let mut new_tokens: Vec<Token> = Vec::new();

    for token in parsed.tokens.iter() {
        match token {
            Token::Tag {
                val: Val::Fn { name, args },
            } if name == "secure" => {
                let mut args_map = HashMap::new();
                for a in args {
                    match a.clone().value {
                        Val::Str { text } => {
                            args_map.insert(a.name.to_string(), serde_json::Value::String(text));
                        }
                        _ => continue,
                    }
                }
                new_tokens.push(Token::Raw {
                    text: template_function_secure_run(app_handle, args_map, plugin_context)?,
                });
            }
            t => {
                new_tokens.push(t.clone());
                continue;
            }
        };
    }

    parsed.tokens = new_tokens;
    Ok(parsed.to_string())
}

pub fn encrypt_secure_template_function<R: Runtime>(
    app_handle: &AppHandle<R>,
    plugin_context: &PluginContext,
    template: &str,
) -> Result<String> {
    let decrypted = decrypt_secure_template_function(&app_handle, plugin_context, template)?;
    let tokens = Tokens {
        tokens: vec![Token::Tag {
            val: Val::Fn {
                name: "secure".to_string(),
                args: vec![FnArg {
                    name: "value".to_string(),
                    value: Val::Str { text: decrypted },
                }],
            },
        }],
    };

    Ok(transform_args(
        tokens,
        &PluginTemplateCallback::new(app_handle, plugin_context, RenderPurpose::Preview),
    )?
    .to_string())
}

pub fn template_function_keychain_run(args: HashMap<String, serde_json::Value>) -> Result<String> {
    let service = args.get("service").and_then(|v| v.as_str()).unwrap_or_default().to_owned();
    let user = args.get("account").and_then(|v| v.as_str()).unwrap_or_default().to_owned();
    debug!("Getting password for service {} and user {}", service, user);
    let entry = match keyring::Entry::new(&service, &user) {
        Ok(e) => e,
        Err(e) => {
            debug!("Failed to initialize keyring entry for '{}' and '{}' {:?}", service, user, e);
            return Ok("".to_string()); // Don't fail for invalid args
        }
    };

    match entry.get_password() {
        Ok(p) => Ok(p),
        Err(NoEntry) => {
            info!("No password found for '{}' and '{}'", service, user);
            Ok("".to_string()) // Don't fail for missing passwords
        }
        Err(e) => Err(RenderError(e.to_string())),
    }
}
