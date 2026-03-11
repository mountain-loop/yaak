use crate::context::CliExecutionContext;
use arboard::Clipboard;
use console::Term;
use inquire::{Confirm, Editor, Password, PasswordDisplayMode, Select, Text};
use serde_json::Value;
use std::collections::HashMap;
use std::io::IsTerminal;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::task::JoinHandle;
use yaak::plugin_events::{
    GroupedPluginEvent, HostRequest, SharedPluginEventContext, handle_shared_plugin_event,
};
use yaak::render::{render_grpc_request, render_http_request};
use yaak::send::{SendHttpRequestWithPluginsParams, send_http_request_with_plugins};
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::Environment;
use yaak_models::queries::any_request::AnyRequest;
use yaak_models::query_manager::QueryManager;
use yaak_models::render::make_vars_hashmap;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    EmptyPayload, ErrorResponse, FormInput, GetCookieValueResponse, InternalEvent,
    InternalEventPayload, JsonPrimitive, ListCookieNamesResponse, ListOpenWorkspacesResponse,
    PluginContext, PromptFormRequest, PromptFormResponse, PromptTextRequest, PromptTextResponse,
    RenderGrpcRequestResponse, RenderHttpRequestResponse, SendHttpRequestResponse,
    TemplateRenderResponse, WindowInfoResponse, WorkspaceInfo,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderOptions, TemplateCallback, render_json_value_raw};

pub struct CliPluginEventBridge {
    rx_id: String,
    task: JoinHandle<()>,
}

struct CliHostContext {
    query_manager: QueryManager,
    blob_manager: BlobManager,
    plugin_manager: Arc<PluginManager>,
    encryption_manager: Arc<EncryptionManager>,
    response_dir: PathBuf,
    execution_context: CliExecutionContext,
}

impl CliPluginEventBridge {
    pub async fn start(
        plugin_manager: Arc<PluginManager>,
        query_manager: QueryManager,
        blob_manager: BlobManager,
        encryption_manager: Arc<EncryptionManager>,
        data_dir: PathBuf,
        execution_context: CliExecutionContext,
    ) -> Self {
        let (rx_id, mut rx) = plugin_manager.subscribe("cli").await;
        let rx_id_for_task = rx_id.clone();
        let pm = plugin_manager.clone();
        let host_context = Arc::new(CliHostContext {
            query_manager,
            blob_manager,
            plugin_manager,
            encryption_manager,
            response_dir: data_dir.join("responses"),
            execution_context,
        });

        let task = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                // Events with reply IDs are replies to app-originated requests.
                if event.reply_id.is_some() {
                    continue;
                }

                let Some(plugin_handle) = pm.get_plugin_by_ref_id(&event.plugin_ref_id).await
                else {
                    eprintln!(
                        "Warning: Ignoring plugin event with unknown plugin ref '{}'",
                        event.plugin_ref_id
                    );
                    continue;
                };

                let pm = pm.clone();
                let host_context = host_context.clone();

                // Avoid deadlocks for nested plugin-host requests (for example, template functions
                // that trigger additional host requests during render) by handling each event in
                // its own task.
                tokio::spawn(async move {
                    let plugin_name = plugin_handle.info().name;
                    let Some(reply_payload) =
                        build_plugin_reply(host_context.as_ref(), &event, &plugin_name).await
                    else {
                        return;
                    };

                    if let Err(err) = pm.reply(&event, &reply_payload).await {
                        eprintln!("Warning: Failed replying to plugin event: {err}");
                    }
                });
            }

            pm.unsubscribe(&rx_id_for_task).await;
        });

        Self { rx_id, task }
    }

    pub async fn shutdown(self, plugin_manager: &PluginManager) {
        plugin_manager.unsubscribe(&self.rx_id).await;
        self.task.abort();
        let _ = self.task.await;
    }
}

async fn build_plugin_reply(
    host_context: &CliHostContext,
    event: &InternalEvent,
    plugin_name: &str,
) -> Option<InternalEventPayload> {
    let execution_context = &host_context.execution_context;
    let shared_workspace_id =
        event.context.workspace_id.as_deref().or(execution_context.workspace_id.as_deref());

    match handle_shared_plugin_event(
        &host_context.query_manager,
        &event.payload,
        SharedPluginEventContext { plugin_name, workspace_id: shared_workspace_id },
    ) {
        GroupedPluginEvent::Handled(payload) => payload,
        GroupedPluginEvent::ToHandle(host_request) => match host_request {
            HostRequest::ErrorResponse(resp) => {
                eprintln!("[plugin:{}] error: {}", plugin_name, resp.error);
                None
            }
            HostRequest::ReloadResponse(_) => None,
            HostRequest::ShowToast(req) => {
                eprintln!("[plugin:{}] {}", plugin_name, req.message);
                Some(InternalEventPayload::ShowToastResponse(EmptyPayload {}))
            }
            HostRequest::ListOpenWorkspaces(_) => {
                let workspaces = match host_context.query_manager.connect().list_workspaces() {
                    Ok(workspaces) => workspaces
                        .into_iter()
                        .map(|w| WorkspaceInfo { id: w.id.clone(), name: w.name, label: w.id })
                        .collect(),
                    Err(err) => {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to list workspaces in CLI: {err}"),
                        }));
                    }
                };
                Some(InternalEventPayload::ListOpenWorkspacesResponse(ListOpenWorkspacesResponse {
                    workspaces,
                }))
            }
            HostRequest::SendHttpRequest(send_http_request_request) => {
                let mut http_request = send_http_request_request.http_request.clone();
                if http_request.workspace_id.is_empty() {
                    let Some(workspace_id) = event
                        .context
                        .workspace_id
                        .clone()
                        .or_else(|| execution_context.workspace_id.clone())
                    else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to send HTTP requests in CLI"
                                .to_string(),
                        }));
                    };
                    http_request.workspace_id = workspace_id;
                }

                let cookie_jar_id =
                    if let Some(cookie_jar_id) = execution_context.cookie_jar_id.clone() {
                        Some(cookie_jar_id)
                    } else {
                        match host_context
                            .query_manager
                            .connect()
                            .list_cookie_jars(http_request.workspace_id.as_str())
                        {
                            Ok(cookie_jars) => cookie_jars
                                .into_iter()
                                .min_by_key(|jar| jar.created_at)
                                .map(|jar| jar.id),
                            Err(err) => {
                                return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                                    error: format!("Failed to list cookie jars in CLI: {err}"),
                                }));
                            }
                        }
                    };
                let plugin_context = PluginContext {
                    workspace_id: Some(http_request.workspace_id.clone()),
                    ..event.context.clone()
                };

                match send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
                    query_manager: &host_context.query_manager,
                    blob_manager: &host_context.blob_manager,
                    request: http_request,
                    environment_id: execution_context.environment_id.as_deref(),
                    update_source: UpdateSource::Plugin,
                    cookie_jar_id,
                    response_dir: &host_context.response_dir,
                    emit_events_to: None,
                    emit_response_body_chunks_to: None,
                    existing_response: None,
                    plugin_manager: host_context.plugin_manager.clone(),
                    encryption_manager: host_context.encryption_manager.clone(),
                    plugin_context: &plugin_context,
                    cancelled_rx: None,
                    connection_manager: None,
                })
                .await
                {
                    Ok(result) => Some(InternalEventPayload::SendHttpRequestResponse(
                        SendHttpRequestResponse { http_response: result.response },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to send HTTP request in CLI: {err}"),
                    })),
                }
            }
            HostRequest::RenderGrpcRequest(render_grpc_request_request) => {
                let mut grpc_request = render_grpc_request_request.grpc_request.clone();
                if grpc_request.workspace_id.is_empty() {
                    let Some(workspace_id) = event
                        .context
                        .workspace_id
                        .clone()
                        .or_else(|| execution_context.workspace_id.clone())
                    else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to render gRPC requests in CLI"
                                .to_string(),
                        }));
                    };
                    grpc_request.workspace_id = workspace_id;
                }

                let plugin_context = PluginContext {
                    workspace_id: Some(grpc_request.workspace_id.clone()),
                    ..event.context.clone()
                };

                let environment_chain =
                    match host_context.query_manager.connect().resolve_environments(
                        &grpc_request.workspace_id,
                        grpc_request.folder_id.as_deref(),
                        execution_context.environment_id.as_deref(),
                    ) {
                        Ok(chain) => chain,
                        Err(err) => {
                            return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to resolve environments in CLI: {err}"),
                            }));
                        }
                    };

                let template_callback = PluginTemplateCallback::new(
                    host_context.plugin_manager.clone(),
                    host_context.encryption_manager.clone(),
                    &plugin_context,
                    render_grpc_request_request.purpose.clone(),
                );
                let render_options = RenderOptions::throw();

                match render_grpc_request(
                    &grpc_request,
                    environment_chain,
                    &template_callback,
                    &render_options,
                )
                .await
                {
                    Ok(grpc_request) => Some(InternalEventPayload::RenderGrpcRequestResponse(
                        RenderGrpcRequestResponse { grpc_request },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to render gRPC request in CLI: {err}"),
                    })),
                }
            }
            HostRequest::RenderHttpRequest(render_http_request_request) => {
                let mut http_request = render_http_request_request.http_request.clone();
                if http_request.workspace_id.is_empty() {
                    let Some(workspace_id) = event
                        .context
                        .workspace_id
                        .clone()
                        .or_else(|| execution_context.workspace_id.clone())
                    else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to render HTTP requests in CLI"
                                .to_string(),
                        }));
                    };
                    http_request.workspace_id = workspace_id;
                }

                let plugin_context = PluginContext {
                    workspace_id: Some(http_request.workspace_id.clone()),
                    ..event.context.clone()
                };

                let environment_chain =
                    match host_context.query_manager.connect().resolve_environments(
                        &http_request.workspace_id,
                        http_request.folder_id.as_deref(),
                        execution_context.environment_id.as_deref(),
                    ) {
                        Ok(chain) => chain,
                        Err(err) => {
                            return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to resolve environments in CLI: {err}"),
                            }));
                        }
                    };

                let template_callback = PluginTemplateCallback::new(
                    host_context.plugin_manager.clone(),
                    host_context.encryption_manager.clone(),
                    &plugin_context,
                    render_http_request_request.purpose.clone(),
                );
                let render_options = RenderOptions::throw();

                match render_http_request(
                    &http_request,
                    environment_chain,
                    &template_callback,
                    &render_options,
                )
                .await
                {
                    Ok(http_request) => Some(InternalEventPayload::RenderHttpRequestResponse(
                        RenderHttpRequestResponse { http_request },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to render HTTP request in CLI: {err}"),
                    })),
                }
            }
            HostRequest::TemplateRender(template_render_request) => {
                let Some(workspace_id) = event
                    .context
                    .workspace_id
                    .clone()
                    .or_else(|| execution_context.workspace_id.clone())
                else {
                    return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: "workspace_id is required to render templates in CLI".to_string(),
                    }));
                };

                let plugin_context = PluginContext {
                    workspace_id: Some(workspace_id.clone()),
                    ..event.context.clone()
                };

                let folder_id = execution_context.request_id.as_ref().and_then(|rid| {
                    match host_context.query_manager.connect().get_any_request(rid) {
                        Ok(AnyRequest::HttpRequest(r)) => r.folder_id,
                        Ok(AnyRequest::GrpcRequest(r)) => r.folder_id,
                        Ok(AnyRequest::WebsocketRequest(r)) => r.folder_id,
                        Err(_) => None,
                    }
                });

                let environment_chain =
                    match host_context.query_manager.connect().resolve_environments(
                        &workspace_id,
                        folder_id.as_deref(),
                        execution_context.environment_id.as_deref(),
                    ) {
                        Ok(chain) => chain,
                        Err(err) => {
                            return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to resolve environments in CLI: {err}"),
                            }));
                        }
                    };

                let template_callback = PluginTemplateCallback::new(
                    host_context.plugin_manager.clone(),
                    host_context.encryption_manager.clone(),
                    &plugin_context,
                    template_render_request.purpose.clone(),
                );
                let render_options = RenderOptions::throw();

                match render_json_value_for_cli(
                    template_render_request.data.clone(),
                    environment_chain,
                    &template_callback,
                    &render_options,
                )
                .await
                {
                    Ok(data) => {
                        Some(InternalEventPayload::TemplateRenderResponse(TemplateRenderResponse {
                            data,
                        }))
                    }
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to render template data in CLI: {err}"),
                    })),
                }
            }
            HostRequest::OpenExternalUrl(open_external_url_request) => {
                match webbrowser::open(open_external_url_request.url.as_str()) {
                    Ok(_) => Some(InternalEventPayload::OpenExternalUrlResponse(EmptyPayload {})),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to open external URL in CLI: {err}"),
                    })),
                }
            }
            HostRequest::CopyText(req) => match copy_text_to_clipboard(req.text.as_str()) {
                Ok(()) => Some(InternalEventPayload::CopyTextResponse(EmptyPayload {})),
                Err(error) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: format!("Failed to copy text in CLI: {error}"),
                })),
            },
            HostRequest::PromptText(req) => match prompt_text_for_cli(req) {
                Ok(value) => {
                    Some(InternalEventPayload::PromptTextResponse(PromptTextResponse { value }))
                }
                Err(error) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: format!("Failed to prompt text in CLI: {error}"),
                })),
            },
            HostRequest::PromptForm(req) => match prompt_form_for_cli(req) {
                Ok(values) => Some(InternalEventPayload::PromptFormResponse(PromptFormResponse {
                    values,
                    done: Some(true),
                })),
                Err(error) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: format!("Failed to prompt form in CLI: {error}"),
                })),
            },
            HostRequest::OpenWindow(_) => {
                Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: "Unsupported plugin request in CLI: open_window_request".to_string(),
                }))
            }
            HostRequest::CloseWindow(_) => {
                Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: "Unsupported plugin request in CLI: close_window_request".to_string(),
                }))
            }
            HostRequest::ListCookieNames(_) => {
                let Some(cookie_jar_id) = execution_context.cookie_jar_id.as_deref() else {
                    return Some(InternalEventPayload::ListCookieNamesResponse(
                        ListCookieNamesResponse { names: Vec::new() },
                    ));
                };

                let cookie_jar =
                    match host_context.query_manager.connect().get_cookie_jar(cookie_jar_id) {
                        Ok(cookie_jar) => cookie_jar,
                        Err(err) => {
                            return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to load cookie jar in CLI: {err}"),
                            }));
                        }
                    };

                let names = cookie_jar
                    .cookies
                    .into_iter()
                    .filter_map(|c| parse_cookie_name_value(&c.raw_cookie).map(|(name, _)| name))
                    .collect();

                Some(InternalEventPayload::ListCookieNamesResponse(ListCookieNamesResponse {
                    names,
                }))
            }
            HostRequest::GetCookieValue(req) => {
                let Some(cookie_jar_id) = execution_context.cookie_jar_id.as_deref() else {
                    return Some(InternalEventPayload::GetCookieValueResponse(
                        GetCookieValueResponse { value: None },
                    ));
                };

                let cookie_jar =
                    match host_context.query_manager.connect().get_cookie_jar(cookie_jar_id) {
                        Ok(cookie_jar) => cookie_jar,
                        Err(err) => {
                            return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to load cookie jar in CLI: {err}"),
                            }));
                        }
                    };

                let value = cookie_jar.cookies.into_iter().find_map(|c| {
                    let (name, value) = parse_cookie_name_value(&c.raw_cookie)?;
                    if name == req.name { Some(value) } else { None }
                });
                Some(InternalEventPayload::GetCookieValueResponse(GetCookieValueResponse { value }))
            }
            HostRequest::WindowInfo(req) => {
                Some(InternalEventPayload::WindowInfoResponse(WindowInfoResponse {
                    label: req.label.clone(),
                    request_id: execution_context.request_id.clone(),
                    workspace_id: execution_context
                        .workspace_id
                        .clone()
                        .or_else(|| event.context.workspace_id.clone()),
                    environment_id: execution_context.environment_id.clone(),
                }))
            }
            HostRequest::OtherRequest(payload) => {
                Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: format!("Unsupported plugin request in CLI: {}", payload.type_name()),
                }))
            }
        },
    }
}

async fn render_json_value_for_cli<T: TemplateCallback>(
    value: Value,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<Value> {
    let vars = &make_vars_hashmap(environment_chain);
    render_json_value_raw(value, vars, cb, opt).await
}


fn parse_cookie_name_value(raw_cookie: &str) -> Option<(String, String)> {
    let first_part = raw_cookie.split(';').next()?.trim();
    let (name, value) = first_part.split_once('=')?;
    Some((name.trim().to_string(), value.to_string()))
}

fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text.to_string()).map_err(|e| e.to_string())
}

fn prompt_text_for_cli(req: &PromptTextRequest) -> Result<Option<String>, String> {
    if !std::io::stdin().is_terminal() {
        return Err("cannot prompt in non-interactive mode".to_string());
    }

    let term = Term::stdout();
    if let Some(description) = &req.description {
        if !description.is_empty() {
            term.write_line(description.as_str()).map_err(|e| e.to_string())?;
        }
    }

    let label = if req.label.is_empty() { req.id.as_str() } else { req.label.as_str() };
    let value = if req.password.unwrap_or(false) {
        prompt_password_with_inquire(
            label,
            req.default_value.clone(),
            req.required.unwrap_or(false),
        )?
    } else {
        prompt_text_with_inquire(
            label,
            req.default_value.clone(),
            req.placeholder.clone(),
            req.required.unwrap_or(false),
        )?
    };

    match value {
        PromptValue::Cancelled => Ok(None),
        PromptValue::Value(v) => Ok(v),
    }
}

fn prompt_form_for_cli(
    req: &PromptFormRequest,
) -> Result<Option<HashMap<String, JsonPrimitive>>, String> {
    if !std::io::stdin().is_terminal() {
        return Err("cannot prompt in non-interactive mode".to_string());
    }

    let term = Term::stdout();
    if let Some(description) = &req.description {
        if !description.is_empty() {
            term.write_line(description.as_str()).map_err(|e| e.to_string())?;
        }
    }

    let mut values = HashMap::new();
    for input in &req.inputs {
        if prompt_form_input_for_cli(input, &mut values)? == PromptOutcome::Cancelled {
            return Ok(None);
        }
    }
    Ok(Some(values))
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum PromptOutcome {
    Continue,
    Cancelled,
}

fn prompt_form_input_for_cli(
    input: &FormInput,
    values: &mut HashMap<String, JsonPrimitive>,
) -> Result<PromptOutcome, String> {
    match input {
        FormInput::Text(input) => {
            if input.base.hidden.unwrap_or(false) || input.base.disabled.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }

            let label = prompt_label_for_base(&input.base);
            let required = !input.base.optional.unwrap_or(false);
            let value = if input.password.unwrap_or(false) {
                prompt_password_with_inquire(
                    label.as_str(),
                    input.base.default_value.clone(),
                    required,
                )?
            } else {
                prompt_text_with_inquire(
                    label.as_str(),
                    input.base.default_value.clone(),
                    input.placeholder.clone(),
                    required,
                )?
            };

            match value {
                PromptValue::Cancelled => Ok(PromptOutcome::Cancelled),
                PromptValue::Value(Some(v)) => {
                    values.insert(input.base.name.clone(), JsonPrimitive::String(v));
                    Ok(PromptOutcome::Continue)
                }
                PromptValue::Value(None) => Ok(PromptOutcome::Continue),
            }
        }
        FormInput::Editor(input) => {
            if input.base.hidden.unwrap_or(false) || input.base.disabled.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }

            let label = prompt_label_for_base(&input.base);
            let required = !input.base.optional.unwrap_or(false);
            let value = prompt_editor_with_inquire(
                label.as_str(),
                input.base.default_value.clone(),
                required,
            )?;
            match value {
                PromptValue::Cancelled => Ok(PromptOutcome::Cancelled),
                PromptValue::Value(Some(v)) => {
                    values.insert(input.base.name.clone(), JsonPrimitive::String(v));
                    Ok(PromptOutcome::Continue)
                }
                PromptValue::Value(None) => Ok(PromptOutcome::Continue),
            }
        }
        FormInput::Select(input) => {
            if input.base.hidden.unwrap_or(false) || input.base.disabled.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }

            let label = prompt_label_for_base(&input.base);
            let options = input.options.iter().map(|o| o.value.clone()).collect::<Vec<_>>();
            let value = prompt_select_with_inquire(
                label.as_str(),
                options,
                input.base.default_value.clone(),
                !input.base.optional.unwrap_or(false),
            )?;
            match value {
                PromptValue::Cancelled => Ok(PromptOutcome::Cancelled),
                PromptValue::Value(Some(v)) => {
                    values.insert(input.base.name.clone(), JsonPrimitive::String(v));
                    Ok(PromptOutcome::Continue)
                }
                PromptValue::Value(None) => Ok(PromptOutcome::Continue),
            }
        }
        FormInput::Checkbox(input) => {
            if input.base.hidden.unwrap_or(false) || input.base.disabled.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }

            let label = prompt_label_for_base(&input.base);
            let default = input
                .base
                .default_value
                .as_deref()
                .map(|v| matches!(v, "1" | "true" | "yes" | "on"))
                .unwrap_or(false);

            match prompt_confirm_with_inquire(label.as_str(), default)? {
                PromptValue::Cancelled => Ok(PromptOutcome::Cancelled),
                PromptValue::Value(Some(v)) => {
                    values.insert(input.base.name.clone(), JsonPrimitive::Boolean(v == "true"));
                    Ok(PromptOutcome::Continue)
                }
                PromptValue::Value(None) => Ok(PromptOutcome::Continue),
            }
        }
        FormInput::File(input) => {
            if input.base.hidden.unwrap_or(false) || input.base.disabled.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }

            let label = prompt_label_for_base(&input.base);
            let value = prompt_text_with_inquire(
                label.as_str(),
                input.base.default_value.clone(),
                Some("Path".to_string()),
                !input.base.optional.unwrap_or(false),
            )?;
            match value {
                PromptValue::Cancelled => Ok(PromptOutcome::Cancelled),
                PromptValue::Value(Some(v)) => {
                    values.insert(input.base.name.clone(), JsonPrimitive::String(v));
                    Ok(PromptOutcome::Continue)
                }
                PromptValue::Value(None) => Ok(PromptOutcome::Continue),
            }
        }
        FormInput::HttpRequest(input) => {
            if input.base.hidden.unwrap_or(false) || input.base.disabled.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }
            let label = prompt_label_for_base(&input.base);
            let value = prompt_text_with_inquire(
                label.as_str(),
                input.base.default_value.clone(),
                Some("Request ID".to_string()),
                !input.base.optional.unwrap_or(false),
            )?;
            match value {
                PromptValue::Cancelled => Ok(PromptOutcome::Cancelled),
                PromptValue::Value(Some(v)) => {
                    values.insert(input.base.name.clone(), JsonPrimitive::String(v));
                    Ok(PromptOutcome::Continue)
                }
                PromptValue::Value(None) => Ok(PromptOutcome::Continue),
            }
        }
        FormInput::KeyValue(input) => {
            if input.base.hidden.unwrap_or(false) || input.base.disabled.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }
            let label = prompt_label_for_base(&input.base);
            let value = prompt_text_with_inquire(
                label.as_str(),
                input.base.default_value.clone(),
                Some("JSON string".to_string()),
                !input.base.optional.unwrap_or(false),
            )?;
            match value {
                PromptValue::Cancelled => Ok(PromptOutcome::Cancelled),
                PromptValue::Value(Some(v)) => {
                    values.insert(input.base.name.clone(), JsonPrimitive::String(v));
                    Ok(PromptOutcome::Continue)
                }
                PromptValue::Value(None) => Ok(PromptOutcome::Continue),
            }
        }
        FormInput::Accordion(input) => {
            if input.hidden.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }
            if let Some(inputs) = &input.inputs {
                for nested in inputs {
                    if prompt_form_input_for_cli(nested, values)? == PromptOutcome::Cancelled {
                        return Ok(PromptOutcome::Cancelled);
                    }
                }
            }
            Ok(PromptOutcome::Continue)
        }
        FormInput::HStack(input) => {
            if input.hidden.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }
            if let Some(inputs) = &input.inputs {
                for nested in inputs {
                    if prompt_form_input_for_cli(nested, values)? == PromptOutcome::Cancelled {
                        return Ok(PromptOutcome::Cancelled);
                    }
                }
            }
            Ok(PromptOutcome::Continue)
        }
        FormInput::Banner(input) => {
            if input.hidden.unwrap_or(false) {
                return Ok(PromptOutcome::Continue);
            }
            if let Some(inputs) = &input.inputs {
                for nested in inputs {
                    if prompt_form_input_for_cli(nested, values)? == PromptOutcome::Cancelled {
                        return Ok(PromptOutcome::Cancelled);
                    }
                }
            }
            Ok(PromptOutcome::Continue)
        }
        FormInput::Markdown(input) => {
            if !input.hidden.unwrap_or(false) && !input.content.trim().is_empty() {
                let term = Term::stdout();
                term.write_line(input.content.as_str()).map_err(|e| e.to_string())?;
            }
            Ok(PromptOutcome::Continue)
        }
    }
}

enum PromptValue {
    Value(Option<String>),
    Cancelled,
}

fn prompt_text_with_inquire(
    label: &str,
    default_value: Option<String>,
    placeholder: Option<String>,
    required: bool,
) -> Result<PromptValue, String> {
    let default_value = default_value.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() { None } else { Some(v) }
    });

    loop {
        let message = prompt_message(label);
        let mut prompt = Text::new(message.as_str());
        if let Some(v) = default_value.as_deref() {
            prompt = prompt.with_default(v);
        }
        if let Some(v) = placeholder.as_deref() {
            if !v.trim().is_empty() {
                prompt = prompt.with_placeholder(v);
            }
        }
        let result = prompt.prompt();
        match result {
            Ok(v) => {
                let v = v.trim().to_string();
                if v.is_empty() {
                    if let Some(default) = default_value.clone() {
                        if !default.trim().is_empty() {
                            return Ok(PromptValue::Value(Some(default)));
                        }
                    }
                    if required {
                        continue;
                    }
                    return Ok(PromptValue::Value(None));
                }
                return Ok(PromptValue::Value(Some(v)));
            }
            Err(inquire::InquireError::OperationCanceled)
            | Err(inquire::InquireError::OperationInterrupted) => {
                return Ok(PromptValue::Cancelled);
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn prompt_password_with_inquire(
    label: &str,
    default_value: Option<String>,
    required: bool,
) -> Result<PromptValue, String> {
    let default_value = default_value.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() { None } else { Some(v) }
    });

    loop {
        let message = prompt_message(label);
        let mut prompt = Password::new(message.as_str()).without_confirmation();
        prompt = prompt.with_display_mode(PasswordDisplayMode::Masked);
        if default_value.as_ref().is_some_and(|v| !v.trim().is_empty()) {
            prompt = prompt.with_help_message("Leave blank to use the default value");
        }
        let result = prompt.prompt();
        match result {
            Ok(v) => {
                let v = v.trim().to_string();
                if v.is_empty() {
                    if let Some(default) = default_value.clone() {
                        if !default.trim().is_empty() {
                            return Ok(PromptValue::Value(Some(default)));
                        }
                    }
                    if required {
                        continue;
                    }
                    return Ok(PromptValue::Value(None));
                }
                return Ok(PromptValue::Value(Some(v)));
            }
            Err(inquire::InquireError::OperationCanceled)
            | Err(inquire::InquireError::OperationInterrupted) => {
                return Ok(PromptValue::Cancelled);
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn prompt_editor_with_inquire(
    label: &str,
    default_value: Option<String>,
    required: bool,
) -> Result<PromptValue, String> {
    loop {
        let message = prompt_message(label);
        let mut prompt = Editor::new(message.as_str());
        if let Some(v) = default_value.as_deref() {
            prompt = prompt.with_predefined_text(v);
        }
        let result = prompt.prompt();
        match result {
            Ok(v) => {
                let v = v.trim().to_string();
                if v.is_empty() {
                    if required {
                        continue;
                    }
                    return Ok(PromptValue::Value(None));
                }
                return Ok(PromptValue::Value(Some(v)));
            }
            Err(inquire::InquireError::OperationCanceled)
            | Err(inquire::InquireError::OperationInterrupted) => {
                return Ok(PromptValue::Cancelled);
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn prompt_select_with_inquire(
    label: &str,
    options: Vec<String>,
    default_value: Option<String>,
    required: bool,
) -> Result<PromptValue, String> {
    if options.is_empty() {
        if required {
            return Err(format!("Select input '{label}' has no options"));
        }
        return Ok(PromptValue::Value(None));
    }

    let index = default_value
        .as_ref()
        .and_then(|d| options.iter().position(|o| o == d))
        .unwrap_or_default();

    let message = prompt_message(label);
    let mut prompt = Select::new(message.as_str(), options);
    if default_value.is_some() {
        prompt = prompt.with_starting_cursor(index);
    }
    match prompt.prompt() {
        Ok(v) => Ok(PromptValue::Value(Some(v))),
        Err(inquire::InquireError::OperationCanceled)
        | Err(inquire::InquireError::OperationInterrupted) => Ok(PromptValue::Cancelled),
        Err(err) => Err(err.to_string()),
    }
}

fn prompt_confirm_with_inquire(label: &str, default: bool) -> Result<PromptValue, String> {
    let message = prompt_message(label);
    match Confirm::new(message.as_str()).with_default(default).prompt() {
        Ok(v) => Ok(PromptValue::Value(Some(if v { "true" } else { "false" }.to_string()))),
        Err(inquire::InquireError::OperationCanceled)
        | Err(inquire::InquireError::OperationInterrupted) => Ok(PromptValue::Cancelled),
        Err(err) => Err(err.to_string()),
    }
}

fn prompt_message(label: &str) -> String {
    format!("{label}:")
}

fn prompt_label_for_base(base: &yaak_plugins::events::FormInputBase) -> String {
    if let Some(label) = &base.label {
        if !label.is_empty() {
            return label.clone();
        }
    }
    base.name.clone()
}
