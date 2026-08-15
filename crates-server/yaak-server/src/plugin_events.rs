//! The bridge's plugin host.
//!
//! Same shape as the CLI's bridge (crates-cli/yaak-cli/src/plugin_events.rs):
//! subscribe to the plugin manager, let `handle_shared_plugin_event` answer
//! everything that is only a database question, and implement the rest here.
//!
//! Where it differs is that a UI is attached. The CLI answers a prompt from a
//! TTY and refuses when there isn't one; the bridge does what the desktop does
//! instead — pushes the event to the tab and waits for the reply keyed by the
//! event's id. Toasts, clipboard writes and external URLs go the same way,
//! because the browser is the only thing here that can show or do them.

use crate::events::EventHub;
use crate::session::SessionStore;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::task::JoinHandle;
use yaak::plugin_events::{
    GroupedPluginEvent, HostRequest, SharedPluginEventContext, handle_shared_plugin_event,
};
use yaak::render::{render_grpc_request, render_http_request};
use yaak::send::{SendHttpRequestWithPluginsParams, send_http_request_with_plugins};
use yaak_crypto::manager::EncryptionManager;
use yaak_http::cookies::get_cookie_value_from_jar;
use yaak_http::manager::HttpConnectionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::Environment;
use yaak_models::queries::any_request::AnyRequest;
use yaak_models::query_manager::QueryManager;
use yaak_models::render::make_vars_hashmap;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    EmptyPayload, ErrorResponse, GetCookieValueResponse, InternalEvent, InternalEventPayload,
    ListCookieNamesResponse, ListOpenWorkspacesResponse, PluginContext, PromptTextResponse,
    RenderGrpcRequestResponse, RenderHttpRequestResponse, SendHttpRequestResponse,
    TemplateRenderResponse, WindowInfoResponse, WorkspaceInfo,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::plugin_handle::PluginHandle;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderOptions, TemplateCallback, render_json_value_raw};

pub struct BridgePluginEventBridge {
    rx_id: String,
    task: JoinHandle<()>,
}

struct BridgeHostContext {
    query_manager: QueryManager,
    blob_manager: BlobManager,
    plugin_manager: Arc<PluginManager>,
    encryption_manager: Arc<EncryptionManager>,
    connection_manager: Arc<HttpConnectionManager>,
    response_dir: PathBuf,
    events: EventHub,
    session: SessionStore,
}

impl BridgePluginEventBridge {
    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        plugin_manager: Arc<PluginManager>,
        query_manager: QueryManager,
        blob_manager: BlobManager,
        encryption_manager: Arc<EncryptionManager>,
        connection_manager: Arc<HttpConnectionManager>,
        data_dir: PathBuf,
        events: EventHub,
        session: SessionStore,
    ) -> Self {
        let (rx_id, mut rx) = plugin_manager.subscribe("bridge").await;
        let rx_id_for_task = rx_id.clone();
        let pm = plugin_manager.clone();
        let host_context = Arc::new(BridgeHostContext {
            query_manager,
            blob_manager,
            plugin_manager,
            encryption_manager,
            connection_manager,
            response_dir: data_dir.join("responses"),
            events,
            session,
        });

        let task = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                // Events with reply IDs are replies to app-originated requests.
                if event.reply_id.is_some() {
                    continue;
                }

                let Some(plugin_handle) = pm.get_plugin_by_ref_id(&event.plugin_ref_id).await
                else {
                    log::warn!(
                        "Ignoring plugin event with unknown plugin ref '{}'",
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
                    let Some(reply_payload) = build_plugin_reply(
                        host_context.as_ref(),
                        &event,
                        &plugin_name,
                        &plugin_handle,
                    )
                    .await
                    else {
                        return;
                    };

                    if let Err(err) = pm.reply(&event, &reply_payload).await {
                        log::warn!("Failed replying to plugin event: {err}");
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
    host_context: &BridgeHostContext,
    event: &InternalEvent,
    plugin_name: &str,
    plugin_handle: &PluginHandle,
) -> Option<InternalEventPayload> {
    let session = host_context.session.get();
    let shared_workspace_id =
        event.context.workspace_id.clone().or_else(|| session.workspace_id());

    match handle_shared_plugin_event(
        &host_context.query_manager,
        &event.payload,
        SharedPluginEventContext {
            plugin_name,
            workspace_id: shared_workspace_id.as_deref(),
        },
    ) {
        GroupedPluginEvent::Handled(payload) => payload,
        GroupedPluginEvent::ToHandle(host_request) => match host_request {
            HostRequest::ErrorResponse(resp) => {
                log::warn!("[plugin:{plugin_name}] error: {}", resp.error);
                None
            }
            HostRequest::ReloadResponse(_) => None,

            // The tab owns everything the user can see or the OS can do. These
            // are fire-and-forget: the plugin gets its acknowledgement as soon
            // as the frame is queued, matching the desktop, which also does not
            // wait for the webview to paint.
            HostRequest::ShowToast(req) => {
                host_context.events.emit("show_toast", &req);
                Some(InternalEventPayload::ShowToastResponse(EmptyPayload {}))
            }
            HostRequest::CopyText(req) => {
                host_context.events.emit("bridge_copy_text", &req);
                Some(InternalEventPayload::CopyTextResponse(EmptyPayload {}))
            }
            HostRequest::OpenExternalUrl(req) => {
                host_context.events.emit("bridge_open_url", &req);
                Some(InternalEventPayload::OpenExternalUrlResponse(EmptyPayload {}))
            }

            // Prompts are questions, so they round-trip: the tab renders the
            // dialog and emits the answer back under the event's own id.
            HostRequest::PromptText(_) => {
                let reply = call_frontend(host_context, event).await;
                Some(reply.unwrap_or(InternalEventPayload::PromptTextResponse(
                    PromptTextResponse { value: None },
                )))
            }

            // A form streams: the tab sends a response per interaction and the
            // plugin re-renders, until one comes back marked done.
            HostRequest::PromptForm(_) => {
                host_context.events.emit("plugin_event", event);
                if event.reply_id.is_none() {
                    spawn_form_reply_pump(host_context, event, plugin_handle);
                }
                None
            }

            HostRequest::ListOpenWorkspaces(_) => {
                let workspaces = match host_context.query_manager.connect().list_workspaces() {
                    Ok(workspaces) => workspaces
                        .into_iter()
                        .map(|w| WorkspaceInfo {
                            id: w.id.clone(),
                            name: w.name,
                            label: session.label.clone(),
                        })
                        .collect(),
                    Err(err) => {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to list workspaces in bridge: {err}"),
                        }));
                    }
                };
                Some(InternalEventPayload::ListOpenWorkspacesResponse(ListOpenWorkspacesResponse {
                    workspaces,
                }))
            }

            HostRequest::SendHttpRequest(req) => {
                let mut http_request = req.http_request.clone();
                if http_request.workspace_id.is_empty() {
                    let Some(workspace_id) = shared_workspace_id.clone() else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to send HTTP requests in bridge"
                                .to_string(),
                        }));
                    };
                    http_request.workspace_id = workspace_id;
                }

                let cookie_jar_id = match session.cookie_jar_id() {
                    Some(id) => Some(id),
                    None => match host_context
                        .query_manager
                        .connect()
                        .list_cookie_jars(http_request.workspace_id.as_str())
                    {
                        Ok(jars) => {
                            jars.into_iter().min_by_key(|jar| jar.created_at).map(|jar| jar.id)
                        }
                        Err(err) => {
                            return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to list cookie jars in bridge: {err}"),
                            }));
                        }
                    },
                };

                let plugin_context = PluginContext {
                    workspace_id: Some(http_request.workspace_id.clone()),
                    ..event.context.clone()
                };

                match send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
                    query_manager: &host_context.query_manager,
                    blob_manager: &host_context.blob_manager,
                    request: http_request,
                    environment_id: session.environment_id().as_deref(),
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
                    connection_manager: &host_context.connection_manager,
                })
                .await
                {
                    Ok(result) => Some(InternalEventPayload::SendHttpRequestResponse(
                        SendHttpRequestResponse { http_response: result.response },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to send HTTP request in bridge: {err}"),
                    })),
                }
            }

            HostRequest::RenderHttpRequest(req) => {
                let mut http_request = req.http_request.clone();
                if http_request.workspace_id.is_empty() {
                    let Some(workspace_id) = shared_workspace_id.clone() else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to render HTTP requests in bridge"
                                .to_string(),
                        }));
                    };
                    http_request.workspace_id = workspace_id;
                }

                let plugin_context = PluginContext {
                    workspace_id: Some(http_request.workspace_id.clone()),
                    ..event.context.clone()
                };

                let environment_chain = match host_context.query_manager.connect().resolve_environments(
                    &http_request.workspace_id,
                    http_request.folder_id.as_deref(),
                    session.environment_id().as_deref(),
                ) {
                    Ok(chain) => chain,
                    Err(err) => {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to resolve environments in bridge: {err}"),
                        }));
                    }
                };

                let template_callback = PluginTemplateCallback::new(
                    host_context.plugin_manager.clone(),
                    host_context.encryption_manager.clone(),
                    &plugin_context,
                    req.purpose.clone(),
                );

                match render_http_request(
                    &http_request,
                    environment_chain,
                    &template_callback,
                    &RenderOptions::throw(),
                )
                .await
                {
                    Ok(http_request) => Some(InternalEventPayload::RenderHttpRequestResponse(
                        RenderHttpRequestResponse { http_request },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to render HTTP request in bridge: {err}"),
                    })),
                }
            }

            HostRequest::RenderGrpcRequest(req) => {
                let mut grpc_request = req.grpc_request.clone();
                if grpc_request.workspace_id.is_empty() {
                    let Some(workspace_id) = shared_workspace_id.clone() else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to render gRPC requests in bridge"
                                .to_string(),
                        }));
                    };
                    grpc_request.workspace_id = workspace_id;
                }

                let plugin_context = PluginContext {
                    workspace_id: Some(grpc_request.workspace_id.clone()),
                    ..event.context.clone()
                };

                let environment_chain = match host_context.query_manager.connect().resolve_environments(
                    &grpc_request.workspace_id,
                    grpc_request.folder_id.as_deref(),
                    session.environment_id().as_deref(),
                ) {
                    Ok(chain) => chain,
                    Err(err) => {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to resolve environments in bridge: {err}"),
                        }));
                    }
                };

                let template_callback = PluginTemplateCallback::new(
                    host_context.plugin_manager.clone(),
                    host_context.encryption_manager.clone(),
                    &plugin_context,
                    req.purpose.clone(),
                );

                match render_grpc_request(
                    &grpc_request,
                    environment_chain,
                    &template_callback,
                    &RenderOptions::throw(),
                )
                .await
                {
                    Ok(grpc_request) => Some(InternalEventPayload::RenderGrpcRequestResponse(
                        RenderGrpcRequestResponse { grpc_request },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to render gRPC request in bridge: {err}"),
                    })),
                }
            }

            HostRequest::TemplateRender(req) => {
                let Some(workspace_id) = shared_workspace_id.clone() else {
                    return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: "workspace_id is required to render templates in bridge".to_string(),
                    }));
                };

                let plugin_context =
                    PluginContext { workspace_id: Some(workspace_id.clone()), ..event.context.clone() };

                let folder_id = session.request_id().and_then(|rid| {
                    match host_context.query_manager.connect().get_any_request(&rid) {
                        Ok(AnyRequest::HttpRequest(r)) => r.folder_id,
                        Ok(AnyRequest::GrpcRequest(r)) => r.folder_id,
                        Ok(AnyRequest::WebsocketRequest(r)) => r.folder_id,
                        Err(_) => None,
                    }
                });

                let environment_chain = match host_context.query_manager.connect().resolve_environments(
                    &workspace_id,
                    folder_id.as_deref(),
                    session.environment_id().as_deref(),
                ) {
                    Ok(chain) => chain,
                    Err(err) => {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to resolve environments in bridge: {err}"),
                        }));
                    }
                };

                let template_callback = PluginTemplateCallback::new(
                    host_context.plugin_manager.clone(),
                    host_context.encryption_manager.clone(),
                    &plugin_context,
                    req.purpose.clone(),
                );

                match render_json_value(
                    req.data.clone(),
                    environment_chain,
                    &template_callback,
                    &RenderOptions::throw(),
                )
                .await
                {
                    Ok(data) => {
                        Some(InternalEventPayload::TemplateRenderResponse(TemplateRenderResponse {
                            data,
                        }))
                    }
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to render template data in bridge: {err}"),
                    })),
                }
            }

            HostRequest::ListCookieNames(_) => {
                let Some(cookie_jar_id) = session.cookie_jar_id() else {
                    return Some(InternalEventPayload::ListCookieNamesResponse(
                        ListCookieNamesResponse { names: Vec::new() },
                    ));
                };
                match host_context.query_manager.connect().get_cookie_jar(&cookie_jar_id) {
                    Ok(jar) => Some(InternalEventPayload::ListCookieNamesResponse(
                        ListCookieNamesResponse {
                            names: jar.cookies.into_iter().map(|c| c.name).collect(),
                        },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to load cookie jar in bridge: {err}"),
                    })),
                }
            }

            HostRequest::GetCookieValue(req) => {
                let Some(cookie_jar_id) = session.cookie_jar_id() else {
                    return Some(InternalEventPayload::GetCookieValueResponse(
                        GetCookieValueResponse { value: None },
                    ));
                };
                match host_context.query_manager.connect().get_cookie_jar(&cookie_jar_id) {
                    Ok(jar) => {
                        let value =
                            get_cookie_value_from_jar(jar.cookies, &req.name, req.domain.as_deref());
                        Some(InternalEventPayload::GetCookieValueResponse(GetCookieValueResponse {
                            value,
                        }))
                    }
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to load cookie jar in bridge: {err}"),
                    })),
                }
            }

            HostRequest::WindowInfo(req) => {
                Some(InternalEventPayload::WindowInfoResponse(WindowInfoResponse {
                    label: req.label.clone(),
                    request_id: session.request_id(),
                    workspace_id: shared_workspace_id.clone(),
                    environment_id: session.environment_id(),
                }))
            }

            // A tab is one window. Opening and closing them needs the
            // multiWindow capability the bridge reports false.
            HostRequest::OpenWindow(_) => Some(unsupported("open_window_request")),
            HostRequest::CloseWindow(_) => Some(unsupported("close_window_request")),
            HostRequest::OtherRequest(payload) => Some(unsupported(&payload.type_name())),
        },
    }
}

fn unsupported(type_name: &str) -> InternalEventPayload {
    InternalEventPayload::ErrorResponse(ErrorResponse {
        error: format!("Unsupported plugin request in bridge: {type_name}"),
    })
}

/// Ask the tab and wait for its answer, keyed by the event's id — the same
/// contract as the desktop's `call_frontend`.
async fn call_frontend(
    host_context: &BridgeHostContext,
    event: &InternalEvent,
) -> Option<InternalEventPayload> {
    // Subscribe before emitting: the tab can answer faster than this task is
    // rescheduled, and a reply that arrives before the listener exists is lost.
    let mut replies = host_context.events.subscribe_inbound(event.id.clone());
    host_context.events.emit("plugin_event", event);

    let value = replies.recv().await?;
    match serde_json::from_value::<InternalEvent>(value) {
        Ok(reply) => Some(reply.payload),
        Err(e) => {
            log::warn!("Failed to parse plugin reply from browser: {e}");
            None
        }
    }
}

/// Forward every form response the tab sends back to the plugin, until one is
/// marked done.
fn spawn_form_reply_pump(
    host_context: &BridgeHostContext,
    event: &InternalEvent,
    plugin_handle: &PluginHandle,
) {
    let mut replies = host_context.events.subscribe_inbound(event.id.clone());
    let plugin_handle = plugin_handle.clone();
    let plugin_context = event.context.clone();

    tokio::spawn(async move {
        while let Some(value) = replies.recv().await {
            let Ok(resp) = serde_json::from_value::<InternalEvent>(value) else {
                log::warn!("Failed to parse form response from browser");
                continue;
            };

            let is_done = matches!(
                &resp.payload,
                InternalEventPayload::PromptFormResponse(r) if r.done.unwrap_or(false)
            );

            let event_to_send = plugin_handle.build_event_to_send(
                &plugin_context,
                &resp.payload,
                Some(resp.reply_id.unwrap_or_default()),
            );
            if let Err(e) = plugin_handle.send(&event_to_send).await {
                log::warn!("Failed to forward form response to plugin: {e:?}");
            }

            if is_done {
                break;
            }
        }
    });
}

async fn render_json_value<T: TemplateCallback>(
    value: Value,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<Value> {
    let vars = &make_vars_hashmap(environment_chain);
    render_json_value_raw(value, vars, cb, opt).await
}
