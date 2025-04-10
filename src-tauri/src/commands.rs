use crate::error::Result;
use crate::render::render_template;
use tauri::{command, Manager, Runtime, WebviewWindow, };
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use yaak_crypto::manager::EncryptionManagerExt;
use yaak_models::query_manager::QueryManagerExt;
use yaak_plugins::events::{PluginWindowContext, RenderPurpose};
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{transform_args, FnArg, Parser, Token, Tokens, Val};

#[command]
pub(crate) async fn cmd_show_workspace_key<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    let key = window.crypto().reveal_workspace_key(workspace_id)?;
    window
        .dialog()
        .message(format!("Your workspace key is \n\n{}", key))
        .kind(MessageDialogKind::Info)
        .show(|_v| {});
    Ok(())
}

#[command]
pub(crate) async fn cmd_decrypt_template<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
    environment_id: Option<&str>,
    template: &str,
) -> Result<String> {
    let mut parsed = Parser::new(template).parse()?;
    let mut new_tokens: Vec<Token> = Vec::new();
    let base_environment = window.db().get_base_environment(&workspace_id)?;
    let environment = match environment_id {
        Some(id) => window.db().get_environment(id).ok(),
        None => None,
    };

    for token in parsed.tokens.iter() {
        match token {
            Token::Tag {
                val: Val::Fn { name, .. },
            } if name == "secure" => {
                // Render each `secure()` template function to decrypt it
                new_tokens.push(Token::Raw {
                    text: render_template(
                        &token.to_string(),
                        &base_environment,
                        environment.as_ref(),
                        &PluginTemplateCallback::new(
                            window.app_handle(),
                            &PluginWindowContext::new(&window),
                            RenderPurpose::Preview,
                        ),
                    )
                    .await?,
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

#[command]
pub(crate) async fn cmd_secure_template<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
    environment_id: Option<&str>,
    template: &str,
) -> Result<String> {
    let cb = PluginTemplateCallback::new(
        window.app_handle(),
        &PluginWindowContext::new(&window),
        RenderPurpose::Preview,
    );
    let decrypted = cmd_decrypt_template(window, workspace_id, environment_id, template).await?;
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

    let new_tokens = transform_args(tokens, &cb).await?;
    Ok(new_tokens.to_string())
}
