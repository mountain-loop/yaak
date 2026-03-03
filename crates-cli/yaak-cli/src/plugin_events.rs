use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::task::JoinHandle;
use yaak::plugin_events::{
    GroupedPluginEvent, HostRequest, SharedPluginEventContext, handle_shared_plugin_event,
};
use yaak::render::render_http_request;
use yaak::send::{SendHttpRequestWithPluginsParams, send_http_request_with_plugins};
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{Environment, GrpcRequest, HttpRequestHeader};
use yaak_models::query_manager::QueryManager;
use yaak_models::render::make_vars_hashmap;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    EmptyPayload, ErrorResponse, InternalEvent, InternalEventPayload, ListOpenWorkspacesResponse,
    RenderGrpcRequestResponse, RenderHttpRequestResponse, SendHttpRequestResponse,
    TemplateRenderResponse, WorkspaceInfo,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderOptions, TemplateCallback, parse_and_render, render_json_value_raw};

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
}

impl CliPluginEventBridge {
    pub async fn start(
        plugin_manager: Arc<PluginManager>,
        query_manager: QueryManager,
        blob_manager: BlobManager,
        encryption_manager: Arc<EncryptionManager>,
        data_dir: PathBuf,
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
    match handle_shared_plugin_event(
        &host_context.query_manager,
        &event.payload,
        SharedPluginEventContext {
            plugin_name,
            workspace_id: event.context.workspace_id.as_deref(),
        },
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
                    let Some(workspace_id) = event.context.workspace_id.clone() else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to send HTTP requests in CLI"
                                .to_string(),
                        }));
                    };
                    http_request.workspace_id = workspace_id;
                }

                let mut plugin_context = event.context.clone();
                if plugin_context.workspace_id.is_none() {
                    plugin_context.workspace_id = Some(http_request.workspace_id.clone());
                }

                match send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
                    query_manager: &host_context.query_manager,
                    blob_manager: &host_context.blob_manager,
                    request: http_request,
                    environment_id: None,
                    update_source: UpdateSource::Plugin,
                    cookie_jar_id: None,
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
                    let Some(workspace_id) = event.context.workspace_id.clone() else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to render gRPC requests in CLI"
                                .to_string(),
                        }));
                    };
                    grpc_request.workspace_id = workspace_id;
                }

                let mut plugin_context = event.context.clone();
                if plugin_context.workspace_id.is_none() {
                    plugin_context.workspace_id = Some(grpc_request.workspace_id.clone());
                }

                let environment_chain =
                    match host_context.query_manager.connect().resolve_environments(
                        &grpc_request.workspace_id,
                        grpc_request.folder_id.as_deref(),
                        None,
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

                match render_grpc_request_for_cli(
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
                    let Some(workspace_id) = event.context.workspace_id.clone() else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to render HTTP requests in CLI"
                                .to_string(),
                        }));
                    };
                    http_request.workspace_id = workspace_id;
                }

                let mut plugin_context = event.context.clone();
                if plugin_context.workspace_id.is_none() {
                    plugin_context.workspace_id = Some(http_request.workspace_id.clone());
                }

                let environment_chain =
                    match host_context.query_manager.connect().resolve_environments(
                        &http_request.workspace_id,
                        http_request.folder_id.as_deref(),
                        None,
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
                let Some(workspace_id) = event.context.workspace_id.clone() else {
                    return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: "workspace_id is required to render templates in CLI".to_string(),
                    }));
                };

                let mut plugin_context = event.context.clone();
                if plugin_context.workspace_id.is_none() {
                    plugin_context.workspace_id = Some(workspace_id.clone());
                }

                let environment_chain = match host_context
                    .query_manager
                    .connect()
                    .resolve_environments(&workspace_id, None, None)
                {
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
            HostRequest::CopyText(_) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                error: "Unsupported plugin request in CLI: copy_text_request".to_string(),
            })),
            HostRequest::PromptText(_) => {
                Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: "Unsupported plugin request in CLI: prompt_text_request".to_string(),
                }))
            }
            HostRequest::PromptForm(_) => {
                Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: "Unsupported plugin request in CLI: prompt_form_request".to_string(),
                }))
            }
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
                Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: "Unsupported plugin request in CLI: list_cookie_names_request"
                        .to_string(),
                }))
            }
            HostRequest::GetCookieValue(_) => {
                Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: "Unsupported plugin request in CLI: get_cookie_value_request"
                        .to_string(),
                }))
            }
            HostRequest::WindowInfo(_) => {
                Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: "Unsupported plugin request in CLI: window_info_request".to_string(),
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

async fn render_grpc_request_for_cli<T: TemplateCallback>(
    grpc_request: &GrpcRequest,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<GrpcRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut metadata = Vec::new();
    for p in grpc_request.metadata.clone() {
        if !p.enabled {
            continue;
        }
        metadata.push(HttpRequestHeader {
            enabled: p.enabled,
            name: parse_and_render(p.name.as_str(), vars, cb, opt).await?,
            value: parse_and_render(p.value.as_str(), vars, cb, opt).await?,
            id: p.id,
        })
    }

    let authentication = {
        let mut disabled = false;
        let mut auth = BTreeMap::new();
        match grpc_request.authentication.get("disabled") {
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
            for (k, v) in grpc_request.authentication.clone() {
                if k == "disabled" {
                    auth.insert(k, Value::Bool(false));
                } else {
                    auth.insert(k, render_json_value_raw(v, vars, cb, opt).await?);
                }
            }
        }
        auth
    };

    let url = parse_and_render(grpc_request.url.as_str(), vars, cb, opt).await?;

    Ok(GrpcRequest { url, metadata, authentication, ..grpc_request.to_owned() })
}
