//! HTTP send action implementation.

use std::collections::BTreeMap;
use std::sync::Arc;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use yaak_actions::{
    ActionError, ActionGroupId, ActionHandler, ActionId, ActionMetadata,
    ActionParams, ActionResult, ActionScope, CurrentContext,
    RequiredContext,
};
use yaak_crypto::manager::EncryptionManager;
use yaak_http::path_placeholders::apply_path_placeholders;
use yaak_http::sender::{HttpSender, ReqwestSender};
use yaak_http::types::{SendableHttpRequest, SendableHttpRequestOptions};
use yaak_models::models::{HttpRequest, HttpRequestHeader, HttpUrlParameter};
use yaak_models::query_manager::QueryManager;
use yaak_models::render::make_vars_hashmap;
use yaak_plugins::events::{PluginContext, RenderPurpose};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{parse_and_render, render_json_value_raw, RenderOptions};

/// Handler for HTTP send action.
pub struct HttpSendActionHandler {
    pub query_manager: Arc<QueryManager>,
    pub plugin_manager: Arc<PluginManager>,
    pub encryption_manager: Arc<EncryptionManager>,
}

/// Metadata for the HTTP send action.
pub fn metadata() -> ActionMetadata {
    ActionMetadata {
        id: ActionId::builtin("http", "send-request"),
        label: "Send HTTP Request".to_string(),
        description: Some("Execute an HTTP request and return the response".to_string()),
        icon: Some("play".to_string()),
        scope: ActionScope::HttpRequest,
        keyboard_shortcut: None,
        requires_selection: true,
        enabled_condition: None,
        group_id: Some(ActionGroupId::builtin("send")),
        order: 10,
        required_context: RequiredContext::requires_target(),
    }
}

impl ActionHandler for HttpSendActionHandler {
    fn handle(
        &self,
        context: CurrentContext,
        params: ActionParams,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<ActionResult, ActionError>> + Send + 'static>,
    > {
        let query_manager = self.query_manager.clone();
        let plugin_manager = self.plugin_manager.clone();
        let encryption_manager = self.encryption_manager.clone();

        Box::pin(async move {
            // Extract request_id from context
            let request_id = context
                .target
                .as_ref()
                .ok_or_else(|| {
                    ActionError::ContextMissing {
                        missing_fields: vec!["target".to_string()],
                    }
                })?
                .id()
                .ok_or_else(|| {
                    ActionError::ContextMissing {
                        missing_fields: vec!["target.id".to_string()],
                    }
                })?
                .to_string();

            // Fetch request and environment from database (synchronous)
            let (request, environment_chain) = {
                let db = query_manager.connect();

                // Fetch HTTP request from database
                let request = db.get_http_request(&request_id).map_err(|e| {
                    ActionError::Internal(format!("Failed to fetch request {}: {}", request_id, e))
                })?;

                // Resolve environment chain for variable substitution
                let environment_chain = if let Some(env_id) = &context.environment_id {
                    db.resolve_environments(
                        &request.workspace_id,
                        request.folder_id.as_deref(),
                        Some(env_id),
                    )
                    .unwrap_or_default()
                } else {
                    db.resolve_environments(
                        &request.workspace_id,
                        request.folder_id.as_deref(),
                        None,
                    )
                    .unwrap_or_default()
                };

                (request, environment_chain)
            }; // db is dropped here

            // Create template callback with plugin support
            let plugin_context = PluginContext::new(None, Some(request.workspace_id.clone()));
            let template_callback = PluginTemplateCallback::new(
                plugin_manager,
                encryption_manager,
                &plugin_context,
                RenderPurpose::Send,
            );

            // Render templates in the request
            let rendered_request = render_http_request(
                &request,
                environment_chain,
                &template_callback,
                &RenderOptions::throw(),
            )
            .await
            .map_err(|e| ActionError::Internal(format!("Failed to render request: {}", e)))?;

            // Build sendable request
            let options = SendableHttpRequestOptions {
                timeout: params
                    .data
                    .get("timeout_ms")
                    .and_then(|v| v.as_u64())
                    .map(|ms| std::time::Duration::from_millis(ms)),
                follow_redirects: params
                    .data
                    .get("follow_redirects")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
            };

            let sendable = SendableHttpRequest::from_http_request(&rendered_request, options)
                .await
                .map_err(|e| ActionError::Internal(format!("Failed to build request: {}", e)))?;

            // Create event channel
            let (event_tx, mut event_rx) = mpsc::channel(100);

            // Spawn task to drain events
            let _event_handle = tokio::spawn(async move {
                while event_rx.recv().await.is_some() {
                    // For now, just drain events
                    // In the future, we could log them or emit them to UI
                }
            });

            // Send the request
            let sender = ReqwestSender::new()
                .map_err(|e| ActionError::Internal(format!("Failed to create HTTP client: {}", e)))?;
            let response = sender
                .send(sendable, event_tx)
                .await
                .map_err(|e| ActionError::Internal(format!("Failed to send request: {}", e)))?;

            // Consume response body
            let status = response.status;
            let status_reason = response.status_reason.clone();
            let headers = response.headers.clone();
            let url = response.url.clone();

            let (body_text, stats) = response
                .text()
                .await
                .map_err(|e| ActionError::Internal(format!("Failed to read response body: {}", e)))?;

            // Return success result with response data
            Ok(ActionResult::Success {
                data: Some(json!({
                    "status": status,
                    "statusReason": status_reason,
                    "headers": headers,
                    "body": body_text,
                    "contentLength": stats.size_decompressed,
                    "url": url,
                })),
                message: Some(format!("HTTP {}", status)),
            })
        })
    }
}

/// Helper function to render templates in an HTTP request.
/// Copied from yaak-cli implementation.
async fn render_http_request(
    r: &HttpRequest,
    environment_chain: Vec<yaak_models::models::Environment>,
    cb: &PluginTemplateCallback,
    opt: &RenderOptions,
) -> Result<HttpRequest, String> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut url_parameters = Vec::new();
    for p in r.url_parameters.clone() {
        if !p.enabled {
            continue;
        }
        url_parameters.push(HttpUrlParameter {
            enabled: p.enabled,
            name: parse_and_render(p.name.as_str(), vars, cb, opt)
                .await
                .map_err(|e| e.to_string())?,
            value: parse_and_render(p.value.as_str(), vars, cb, opt)
                .await
                .map_err(|e| e.to_string())?,
            id: p.id,
        })
    }

    let mut headers = Vec::new();
    for p in r.headers.clone() {
        if !p.enabled {
            continue;
        }
        headers.push(HttpRequestHeader {
            enabled: p.enabled,
            name: parse_and_render(p.name.as_str(), vars, cb, opt)
                .await
                .map_err(|e| e.to_string())?,
            value: parse_and_render(p.value.as_str(), vars, cb, opt)
                .await
                .map_err(|e| e.to_string())?,
            id: p.id,
        })
    }

    let mut body = BTreeMap::new();
    for (k, v) in r.body.clone() {
        body.insert(
            k,
            render_json_value_raw(v, vars, cb, opt)
                .await
                .map_err(|e| e.to_string())?,
        );
    }

    let authentication = {
        let mut disabled = false;
        let mut auth = BTreeMap::new();
        match r.authentication.get("disabled") {
            Some(Value::Bool(true)) => {
                disabled = true;
            }
            Some(Value::String(tmpl)) => {
                disabled = parse_and_render(tmpl.as_str(), vars, cb, opt)
                    .await
                    .unwrap_or_default()
                    .is_empty();
            }
            _ => {}
        }
        if disabled {
            auth.insert("disabled".to_string(), Value::Bool(true));
        } else {
            for (k, v) in r.authentication.clone() {
                if k == "disabled" {
                    auth.insert(k, Value::Bool(false));
                } else {
                    auth.insert(
                        k,
                        render_json_value_raw(v, vars, cb, opt)
                            .await
                            .map_err(|e| e.to_string())?,
                    );
                }
            }
        }
        auth
    };

    let url = parse_and_render(r.url.clone().as_str(), vars, cb, opt)
        .await
        .map_err(|e| e.to_string())?;

    // Apply path placeholders (e.g., /users/:id -> /users/123)
    let (url, url_parameters) = apply_path_placeholders(&url, &url_parameters);

    Ok(HttpRequest {
        url,
        url_parameters,
        headers,
        body,
        authentication,
        ..r.to_owned()
    })
}
