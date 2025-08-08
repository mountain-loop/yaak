extern crate core;
use crate::encoding::read_response_body;
use crate::error::Error::GenericError;
use crate::grpc::{build_metadata, metadata_to_map, resolve_grpc_request};
use crate::http_request::{resolve_http_request, send_http_request};
use crate::import::import_data;
use crate::notifications::YaakNotifier;
use crate::render::{render_grpc_request, render_template};
use crate::updates::{UpdateMode, UpdateTrigger, YaakUpdater};
use crate::uri_scheme::handle_deep_link;
use error::Result as YaakResult;
use eventsource_client::{EventParser, SSE};
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::fs::{File, create_dir_all};
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;
use std::{fs, panic};
use tauri::{AppHandle, Emitter, RunEvent, State, WebviewWindow, is_dev};
use tauri::{Listener, Runtime};
use tauri::{Manager, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_log::fern::colors::ColoredLevelConfig;
use tauri_plugin_log::{Builder, Target, TargetKind};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use tokio::sync::Mutex;
use tokio::task::block_in_place;
use yaak_common::window::WorkspaceWindowTrait;
use yaak_grpc::manager::{DynamicMessage, GrpcHandle};
use yaak_grpc::{Code, ServiceDefinition, deserialize_message, serialize_message};
use yaak_models::models::{
    CookieJar, Environment, GrpcConnection, GrpcConnectionState, GrpcEvent, GrpcEventType,
    GrpcRequest, HttpRequest, HttpResponse, HttpResponseState, Plugin, Workspace, WorkspaceMeta,
};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::{BatchUpsertResult, UpdateSource, get_workspace_export_resources};
use yaak_plugins::events::{
    CallGrpcRequestActionArgs, CallGrpcRequestActionRequest, CallHttpRequestActionArgs,
    CallHttpRequestActionRequest, Color, FilterResponse, GetGrpcRequestActionsResponse,
    GetHttpAuthenticationConfigResponse, GetHttpAuthenticationSummaryResponse,
    GetHttpRequestActionsResponse, GetTemplateFunctionsResponse, InternalEvent,
    InternalEventPayload, JsonPrimitive, PluginWindowContext, RenderPurpose, ShowToastRequest,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::plugin_meta::PluginMetadata;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_sse::sse::ServerSentEvent;
use yaak_templates::format::format_json;
use yaak_templates::{Tokens, transform_args};

mod commands;
mod encoding;
mod error;
mod grpc;
mod history;
mod http_request;
mod import;
mod notifications;
mod plugin_events;
mod render;
mod updates;
mod uri_scheme;
mod window;
mod window_menu;

#[derive(serde::Serialize)]
#[serde(default, rename_all = "camelCase")]
struct AppMetaData {
    is_dev: bool,
    version: String,
    name: String,
    app_data_dir: String,
    app_log_dir: String,
}

#[tauri::command]
async fn cmd_metadata(app_handle: AppHandle) -> YaakResult<AppMetaData> {
    let app_data_dir = app_handle.path().app_data_dir()?;
    let app_log_dir = app_handle.path().app_log_dir()?;
    Ok(AppMetaData {
        is_dev: is_dev(),
        version: app_handle.package_info().version.to_string(),
        name: app_handle.package_info().name.to_string(),
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
        app_log_dir: app_log_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn cmd_template_tokens_to_string<R: Runtime>(
    window: WebviewWindow<R>,
    app_handle: AppHandle<R>,
    tokens: Tokens,
) -> YaakResult<String> {
    let cb = PluginTemplateCallback::new(
        &app_handle,
        &PluginWindowContext::new(&window),
        RenderPurpose::Preview,
    );
    let new_tokens = transform_args(tokens, &cb)?;
    Ok(new_tokens.to_string())
}

#[tauri::command]
async fn cmd_render_template<R: Runtime>(
    window: WebviewWindow<R>,
    app_handle: AppHandle<R>,
    template: &str,
    workspace_id: &str,
    environment_id: Option<&str>,
) -> YaakResult<String> {
    let environment = match environment_id {
        Some(id) => app_handle.db().get_environment(id).ok(),
        None => None,
    };
    let base_environment = app_handle.db().get_base_environment(&workspace_id)?;
    let result = render_template(
        template,
        &base_environment,
        environment.as_ref(),
        &PluginTemplateCallback::new(
            &app_handle,
            &PluginWindowContext::new(&window),
            RenderPurpose::Preview,
        ),
    )
    .await?;
    Ok(result)
}

#[tauri::command]
async fn cmd_dismiss_notification<R: Runtime>(
    window: WebviewWindow<R>,
    notification_id: &str,
    yaak_notifier: State<'_, Mutex<YaakNotifier>>,
) -> YaakResult<()> {
    Ok(yaak_notifier.lock().await.seen(&window, notification_id).await?)
}

#[tauri::command]
async fn cmd_grpc_reflect<R: Runtime>(
    request_id: &str,
    environment_id: Option<&str>,
    proto_files: Vec<String>,
    window: WebviewWindow<R>,
    app_handle: AppHandle<R>,
    grpc_handle: State<'_, Mutex<GrpcHandle>>,
) -> YaakResult<Vec<ServiceDefinition>> {
    let environment = match environment_id {
        Some(id) => app_handle.db().get_environment(id).ok(),
        None => None,
    };
    let unrendered_request = app_handle.db().get_grpc_request(request_id)?;
    let (resolved_request, auth_context_id) = resolve_grpc_request(&window, &unrendered_request)?;

    let base_environment =
        app_handle.db().get_base_environment(&unrendered_request.workspace_id)?;
    let workspace = app_handle.db().get_workspace(&unrendered_request.workspace_id)?;

    let req = render_grpc_request(
        &resolved_request,
        &base_environment,
        environment.as_ref(),
        &PluginTemplateCallback::new(
            &app_handle,
            &PluginWindowContext::new(&window),
            RenderPurpose::Send,
        ),
    )
    .await?;

    let uri = safe_uri(&req.url);
    let metadata = build_metadata(&window, &req, &auth_context_id).await?;

    Ok(grpc_handle
        .lock()
        .await
        .services(
            &req.id,
            &uri,
            &proto_files.iter().map(|p| PathBuf::from_str(p).unwrap()).collect(),
            &metadata,
            workspace.setting_validate_certificates,
        )
        .await
        .map_err(|e| GenericError(e.to_string()))?)
}

#[tauri::command]
async fn cmd_grpc_go<R: Runtime>(
    request_id: &str,
    environment_id: Option<&str>,
    proto_files: Vec<String>,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    grpc_handle: State<'_, Mutex<GrpcHandle>>,
) -> YaakResult<String> {
    let environment = match environment_id {
        Some(id) => app_handle.db().get_environment(id).ok(),
        None => None,
    };
    let unrendered_request = app_handle.db().get_grpc_request(request_id)?;
    let (resolved_request, auth_context_id) = resolve_grpc_request(&window, &unrendered_request)?;
    let base_environment =
        app_handle.db().get_base_environment(&unrendered_request.workspace_id)?;
    let workspace = app_handle.db().get_workspace(&unrendered_request.workspace_id)?;

    let request = render_grpc_request(
        &resolved_request,
        &base_environment,
        environment.as_ref(),
        &PluginTemplateCallback::new(
            &app_handle,
            &PluginWindowContext::new(&window),
            RenderPurpose::Send,
        ),
    )
    .await?;

    let metadata = build_metadata(&window, &request, &auth_context_id).await?;

    let conn = app_handle.db().upsert_grpc_connection(
        &GrpcConnection {
            workspace_id: request.workspace_id.clone(),
            request_id: request.id.clone(),
            status: -1,
            elapsed: 0,
            state: GrpcConnectionState::Initialized,
            url: request.url.clone(),
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )?;

    let conn_id = conn.id.clone();

    let base_msg = GrpcEvent {
        workspace_id: request.clone().workspace_id,
        request_id: request.clone().id,
        connection_id: conn.clone().id,
        ..Default::default()
    };

    let (in_msg_tx, in_msg_rx) = tauri::async_runtime::channel::<DynamicMessage>(16);
    let maybe_in_msg_tx = std::sync::Mutex::new(Some(in_msg_tx.clone()));
    let (cancelled_tx, mut cancelled_rx) = tokio::sync::watch::channel(false);

    let uri = safe_uri(&request.url);

    let in_msg_stream = tokio_stream::wrappers::ReceiverStream::new(in_msg_rx);

    let (service, method) = {
        let req = request.clone();
        match (req.service, req.method) {
            (Some(service), Some(method)) => (service, method),
            _ => return Err(GenericError("Service and method are required".to_string())),
        }
    };

    let start = std::time::Instant::now();
    let connection = grpc_handle
        .lock()
        .await
        .connect(
            &request.clone().id,
            uri.as_str(),
            &proto_files.iter().map(|p| PathBuf::from_str(p).unwrap()).collect(),
            &metadata,
            workspace.setting_validate_certificates,
        )
        .await;

    let connection = match connection {
        Ok(c) => c,
        Err(err) => {
            app_handle.db().upsert_grpc_connection(
                &GrpcConnection {
                    elapsed: start.elapsed().as_millis() as i32,
                    error: Some(err.clone()),
                    state: GrpcConnectionState::Closed,
                    ..conn.clone()
                },
                &UpdateSource::from_window(&window),
            )?;
            return Ok(conn_id);
        }
    };

    let method_desc =
        connection.method(&service, &method).map_err(|e| GenericError(e.to_string()))?;

    #[derive(serde::Deserialize)]
    enum IncomingMsg {
        Message(String),
        Cancel,
        Commit,
    }

    let cb = {
        let cancelled_rx = cancelled_rx.clone();
        let app_handle = app_handle.clone();
        let window = window.clone();
        let base_environment = base_environment.clone();
        let environment = environment.clone();
        let base_msg = base_msg.clone();
        let method_desc = method_desc.clone();

        move |ev: tauri::Event| {
            if *cancelled_rx.borrow() {
                // Stream is canceled
                return;
            }

            let mut maybe_in_msg_tx = maybe_in_msg_tx.lock().expect("previous holder not to panic");
            let in_msg_tx = if let Some(in_msg_tx) = maybe_in_msg_tx.as_ref() {
                in_msg_tx
            } else {
                // This would mean that the stream is already committed because
                // we have already dropped the sending half
                return;
            };

            match serde_json::from_str::<IncomingMsg>(ev.payload()) {
                Ok(IncomingMsg::Message(msg)) => {
                    let window = window.clone();
                    let app_handle = app_handle.clone();
                    let base_msg = base_msg.clone();
                    let method_desc = method_desc.clone();
                    let msg = block_in_place(|| {
                        tauri::async_runtime::block_on(async {
                            render_template(
                                msg.as_str(),
                                &base_environment,
                                environment.as_ref(),
                                &PluginTemplateCallback::new(
                                    &app_handle,
                                    &PluginWindowContext::new(&window),
                                    RenderPurpose::Send,
                                ),
                            )
                            .await
                            .expect("Failed to render template")
                        })
                    });
                    let d_msg: DynamicMessage = match deserialize_message(msg.as_str(), method_desc)
                    {
                        Ok(d_msg) => d_msg,
                        Err(e) => {
                            tauri::async_runtime::spawn(async move {
                                app_handle
                                    .db()
                                    .upsert_grpc_event(
                                        &GrpcEvent {
                                            event_type: GrpcEventType::Error,
                                            content: e.to_string(),
                                            ..base_msg.clone()
                                        },
                                        &UpdateSource::from_window(&window),
                                    )
                                    .unwrap();
                            });
                            return;
                        }
                    };
                    in_msg_tx.try_send(d_msg).unwrap();
                    tauri::async_runtime::spawn(async move {
                        app_handle
                            .db()
                            .upsert_grpc_event(
                                &GrpcEvent {
                                    content: msg,
                                    event_type: GrpcEventType::ClientMessage,
                                    ..base_msg.clone()
                                },
                                &UpdateSource::from_window(&window),
                            )
                            .unwrap();
                    });
                }
                Ok(IncomingMsg::Commit) => {
                    maybe_in_msg_tx.take();
                }
                Ok(IncomingMsg::Cancel) => {
                    cancelled_tx.send_replace(true);
                }
                Err(e) => {
                    error!("Failed to parse gRPC message: {:?}", e);
                }
            }
        }
    };
    let event_handler = app_handle.listen_any(format!("grpc_client_msg_{}", conn.id).as_str(), cb);

    let grpc_listen = {
        let window = window.clone();
        let app_handle = app_handle.clone();
        let base_event = base_msg.clone();
        let req = request.clone();
        let msg = if req.message.is_empty() { "{}".to_string() } else { req.message };
        let msg = render_template(
            msg.as_str(),
            &base_environment.clone(),
            environment.as_ref(),
            &PluginTemplateCallback::new(
                &app_handle,
                &PluginWindowContext::new(&window),
                RenderPurpose::Send,
            ),
        )
        .await?;

        app_handle.db().upsert_grpc_event(
            &GrpcEvent {
                content: format!("Connecting to {}", req.url),
                event_type: GrpcEventType::ConnectionStart,
                metadata: metadata.clone(),
                ..base_event.clone()
            },
            &UpdateSource::from_window(&window),
        )?;

        async move {
            let (maybe_stream, maybe_msg) =
                match (method_desc.is_client_streaming(), method_desc.is_server_streaming()) {
                    (true, true) => (
                        Some(
                            connection.streaming(&service, &method, in_msg_stream, &metadata).await,
                        ),
                        None,
                    ),
                    (true, false) => (
                        None,
                        Some(
                            connection
                                .client_streaming(&service, &method, in_msg_stream, &metadata)
                                .await,
                        ),
                    ),
                    (false, true) => (
                        Some(connection.server_streaming(&service, &method, &msg, &metadata).await),
                        None,
                    ),
                    (false, false) => {
                        (None, Some(connection.unary(&service, &method, &msg, &metadata).await))
                    }
                };

            if !method_desc.is_client_streaming() {
                app_handle
                    .db()
                    .upsert_grpc_event(
                        &GrpcEvent {
                            event_type: GrpcEventType::ClientMessage,
                            content: msg,
                            ..base_event.clone()
                        },
                        &UpdateSource::from_window(&window),
                    )
                    .unwrap();
            }

            match maybe_msg {
                Some(Ok(msg)) => {
                    app_handle
                        .db()
                        .upsert_grpc_event(
                            &GrpcEvent {
                                metadata: metadata_to_map(msg.metadata().clone()),
                                content: if msg.metadata().len() == 0 {
                                    "Received response"
                                } else {
                                    "Received response with metadata"
                                }
                                .to_string(),
                                event_type: GrpcEventType::Info,
                                ..base_event.clone()
                            },
                            &UpdateSource::from_window(&window),
                        )
                        .unwrap();
                    app_handle
                        .db()
                        .upsert_grpc_event(
                            &GrpcEvent {
                                content: serialize_message(&msg.into_inner()).unwrap(),
                                event_type: GrpcEventType::ServerMessage,
                                ..base_event.clone()
                            },
                            &UpdateSource::from_window(&window),
                        )
                        .unwrap();
                    app_handle
                        .db()
                        .upsert_grpc_event(
                            &GrpcEvent {
                                content: "Connection complete".to_string(),
                                event_type: GrpcEventType::ConnectionEnd,
                                status: Some(Code::Ok as i32),
                                ..base_event.clone()
                            },
                            &UpdateSource::from_window(&window),
                        )
                        .unwrap();
                }
                Some(Err(e)) => {
                    app_handle
                        .db()
                        .upsert_grpc_event(
                            &(match e.status {
                                Some(s) => GrpcEvent {
                                    error: Some(s.message().to_string()),
                                    status: Some(s.code() as i32),
                                    content: "Failed to connect".to_string(),
                                    metadata: metadata_to_map(s.metadata().clone()),
                                    event_type: GrpcEventType::ConnectionEnd,
                                    ..base_event.clone()
                                },
                                None => GrpcEvent {
                                    error: Some(e.message),
                                    status: Some(Code::Unknown as i32),
                                    content: "Failed to connect".to_string(),
                                    event_type: GrpcEventType::ConnectionEnd,
                                    ..base_event.clone()
                                },
                            }),
                            &UpdateSource::from_window(&window),
                        )
                        .unwrap();
                }
                None => {
                    // Server streaming doesn't return the initial message
                }
            }

            let mut stream = match maybe_stream {
                Some(Ok(stream)) => {
                    app_handle
                        .db()
                        .upsert_grpc_event(
                            &GrpcEvent {
                                metadata: metadata_to_map(stream.metadata().clone()),
                                content: if stream.metadata().len() == 0 {
                                    "Received response"
                                } else {
                                    "Received response with metadata"
                                }
                                .to_string(),
                                event_type: GrpcEventType::Info,
                                ..base_event.clone()
                            },
                            &UpdateSource::from_window(&window),
                        )
                        .unwrap();
                    stream.into_inner()
                }
                Some(Err(e)) => {
                    warn!("GRPC stream error {e:?}");
                    app_handle
                        .db()
                        .upsert_grpc_event(
                            &(match e.status {
                                Some(s) => GrpcEvent {
                                    error: Some(s.message().to_string()),
                                    status: Some(s.code() as i32),
                                    content: "Failed to connect".to_string(),
                                    metadata: metadata_to_map(s.metadata().clone()),
                                    event_type: GrpcEventType::ConnectionEnd,
                                    ..base_event.clone()
                                },
                                None => GrpcEvent {
                                    error: Some(e.message),
                                    status: Some(Code::Unknown as i32),
                                    content: "Failed to connect".to_string(),
                                    event_type: GrpcEventType::ConnectionEnd,
                                    ..base_event.clone()
                                },
                            }),
                            &UpdateSource::from_window(&window),
                        )
                        .unwrap();
                    return;
                }
                None => return,
            };

            loop {
                match stream.message().await {
                    Ok(Some(msg)) => {
                        let message = serialize_message(&msg).unwrap();
                        app_handle
                            .db()
                            .upsert_grpc_event(
                                &GrpcEvent {
                                    content: message,
                                    event_type: GrpcEventType::ServerMessage,
                                    ..base_event.clone()
                                },
                                &UpdateSource::from_window(&window),
                            )
                            .unwrap();
                    }
                    Ok(None) => {
                        let trailers =
                            stream.trailers().await.unwrap_or_default().unwrap_or_default();
                        app_handle
                            .db()
                            .upsert_grpc_event(
                                &GrpcEvent {
                                    content: "Connection complete".to_string(),
                                    status: Some(Code::Ok as i32),
                                    metadata: metadata_to_map(trailers),
                                    event_type: GrpcEventType::ConnectionEnd,
                                    ..base_event.clone()
                                },
                                &UpdateSource::from_window(&window),
                            )
                            .unwrap();
                        break;
                    }
                    Err(status) => {
                        app_handle
                            .db()
                            .upsert_grpc_event(
                                &GrpcEvent {
                                    content: status.to_string(),
                                    status: Some(status.code() as i32),
                                    metadata: metadata_to_map(status.metadata().clone()),
                                    event_type: GrpcEventType::ConnectionEnd,
                                    ..base_event.clone()
                                },
                                &UpdateSource::from_window(&window),
                            )
                            .unwrap();
                    }
                }
            }
        }
    };

    {
        let conn_id = conn_id.clone();
        tauri::async_runtime::spawn(async move {
            let w = app_handle.clone();
            tokio::select! {
                _ = grpc_listen => {
                    let events = w.db().list_grpc_events(&conn_id).unwrap();
                    let closed_event = events
                        .iter()
                        .find(|e| GrpcEventType::ConnectionEnd == e.event_type);
                    let closed_status = closed_event.and_then(|e| e.status).unwrap_or(Code::Unavailable as i32);
                    w.with_tx(|c| {
                        c.upsert_grpc_connection(
                            &GrpcConnection{
                                elapsed: start.elapsed().as_millis() as i32,
                                status: closed_status,
                                state: GrpcConnectionState::Closed,
                                ..c.get_grpc_connection( &conn_id).unwrap().clone()
                            },
                            &UpdateSource::from_window(&window),
                        )
                    }).unwrap();
                },
                _ = cancelled_rx.changed() => {
                    w.db().upsert_grpc_event(
                        &GrpcEvent {
                            content: "Cancelled".to_string(),
                            event_type: GrpcEventType::ConnectionEnd,
                            status: Some(Code::Cancelled as i32),
                            ..base_msg.clone()
                        },
                        &UpdateSource::from_window(&window),
                    ).unwrap();
                    w.with_tx(|c| {
                        c.upsert_grpc_connection(
                            &GrpcConnection{
                            elapsed: start.elapsed().as_millis() as i32,
                            status: Code::Cancelled as i32,
                            state: GrpcConnectionState::Closed,
                                ..c.get_grpc_connection( &conn_id).unwrap().clone()
                            },
                            &UpdateSource::from_window(&window),
                        )
                    }).unwrap();
                },
            }
            w.unlisten(event_handler);
        });
    };

    Ok(conn.id)
}

#[tauri::command]
async fn cmd_send_ephemeral_request<R: Runtime>(
    mut request: HttpRequest,
    environment_id: Option<&str>,
    cookie_jar_id: Option<&str>,
    window: WebviewWindow,
    app_handle: AppHandle<R>,
) -> YaakResult<HttpResponse> {
    let response = HttpResponse::default();
    request.id = "".to_string();
    let environment = match environment_id {
        Some(id) => Some(app_handle.db().get_environment(id)?),
        None => None,
    };
    let cookie_jar = match cookie_jar_id {
        Some(id) => Some(app_handle.db().get_cookie_jar(id)?),
        None => None,
    };

    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    window.listen_any(format!("cancel_http_response_{}", response.id), move |_event| {
        if let Err(e) = cancel_tx.send(true) {
            warn!("Failed to send cancel event for ephemeral request {e:?}");
        }
    });

    send_http_request(&window, &request, &response, environment, cookie_jar, &mut cancel_rx).await
}

#[tauri::command]
async fn cmd_format_json(text: &str) -> YaakResult<String> {
    Ok(format_json(text, "  "))
}

#[tauri::command]
async fn cmd_filter_response<R: Runtime>(
    window: WebviewWindow<R>,
    app_handle: AppHandle<R>,
    response_id: &str,
    plugin_manager: State<'_, PluginManager>,
    filter: &str,
) -> YaakResult<FilterResponse> {
    let response = app_handle.db().get_http_response(response_id)?;

    if let None = response.body_path {
        return Err(GenericError("Response body path not set".to_string()));
    }

    let mut content_type = "".to_string();
    for header in response.headers.iter() {
        if header.name.to_lowercase() == "content-type" {
            content_type = header.value.to_string().to_lowercase();
            break;
        }
    }

    let body = read_response_body(response)
        .await
        .ok_or(GenericError("Failed to find response body".to_string()))?;

    // TODO: Have plugins register their own content type (regex?)
    Ok(plugin_manager.filter_data(&window, filter, &body, &content_type).await?)
}

#[tauri::command]
async fn cmd_get_sse_events(file_path: &str) -> YaakResult<Vec<ServerSentEvent>> {
    let body = fs::read(file_path)?;
    let mut event_parser = EventParser::new();
    event_parser.process_bytes(body.into())?;

    let mut events = Vec::new();
    while let Some(e) = event_parser.get_event() {
        if let SSE::Event(e) = e {
            events.push(ServerSentEvent {
                event_type: e.event_type,
                data: e.data,
                id: e.id,
                retry: e.retry,
            });
        }
    }

    Ok(events)
}

#[tauri::command]
async fn cmd_import_data<R: Runtime>(
    window: WebviewWindow<R>,
    file_path: &str,
) -> YaakResult<BatchUpsertResult> {
    import_data(&window, file_path).await
}

#[tauri::command]
async fn cmd_http_request_actions<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<Vec<GetHttpRequestActionsResponse>> {
    Ok(plugin_manager.get_http_request_actions(&window).await?)
}

#[tauri::command]
async fn cmd_grpc_request_actions<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<Vec<GetGrpcRequestActionsResponse>> {
    Ok(plugin_manager.get_grpc_request_actions(&window).await?)
}

#[tauri::command]
async fn cmd_template_functions<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<Vec<GetTemplateFunctionsResponse>> {
    Ok(plugin_manager.get_template_functions(&window).await?)
}

#[tauri::command]
async fn cmd_get_http_authentication_summaries<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<Vec<GetHttpAuthenticationSummaryResponse>> {
    let results = plugin_manager.get_http_authentication_summaries(&window).await?;
    Ok(results.into_iter().map(|(_, a)| a).collect())
}

#[tauri::command]
async fn cmd_get_http_authentication_config<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
    auth_name: &str,
    values: HashMap<String, JsonPrimitive>,
    request_id: &str,
    environment_id: Option<&str>,
    workspace_id: &str,
) -> YaakResult<GetHttpAuthenticationConfigResponse> {
    let base_environment = window.db().get_base_environment(&workspace_id)?;
    let environment = match environment_id {
        Some(id) => match window.db().get_environment(id) {
            Ok(env) => Some(env),
            Err(e) => {
                warn!("Failed to find environment by id {id} {}", e);
                None
            }
        },
        None => None,
    };
    Ok(plugin_manager
        .get_http_authentication_config(
            &window,
            &base_environment,
            environment.as_ref(),
            auth_name,
            values,
            request_id,
        )
        .await?)
}

#[tauri::command]
async fn cmd_call_http_request_action<R: Runtime>(
    window: WebviewWindow<R>,
    req: CallHttpRequestActionRequest,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<()> {
    Ok(plugin_manager
        .call_http_request_action(
            &window,
            CallHttpRequestActionRequest {
                args: CallHttpRequestActionArgs {
                    http_request: resolve_http_request(&window, &req.args.http_request)?.0,
                    ..req.args
                },
                ..req
            },
        )
        .await?)
}

#[tauri::command]
async fn cmd_call_grpc_request_action<R: Runtime>(
    window: WebviewWindow<R>,
    req: CallGrpcRequestActionRequest,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<()> {
    Ok(plugin_manager
        .call_grpc_request_action(
            &window,
            CallGrpcRequestActionRequest {
                args: CallGrpcRequestActionArgs {
                    grpc_request: resolve_grpc_request(&window, &req.args.grpc_request)?.0,
                    ..req.args
                },
                ..req
            },
        )
        .await?)
}

#[tauri::command]
async fn cmd_call_http_authentication_action<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
    auth_name: &str,
    action_index: i32,
    values: HashMap<String, JsonPrimitive>,
    model_id: &str,
    workspace_id: &str,
    environment_id: Option<&str>,
) -> YaakResult<()> {
    let base_environment = window.db().get_base_environment(&workspace_id)?;
    let environment = match environment_id {
        Some(id) => match window.db().get_environment(id) {
            Ok(env) => Some(env),
            Err(e) => {
                warn!("Failed to find environment by id {id} {}", e);
                None
            }
        },
        None => None,
    };
    Ok(plugin_manager
        .call_http_authentication_action(
            &window,
            &base_environment,
            environment.as_ref(),
            auth_name,
            action_index,
            values,
            model_id,
        )
        .await?)
}

#[tauri::command]
async fn cmd_curl_to_request<R: Runtime>(
    window: WebviewWindow<R>,
    command: &str,
    plugin_manager: State<'_, PluginManager>,
    workspace_id: &str,
) -> YaakResult<HttpRequest> {
    let import_result = plugin_manager.import_data(&window, command).await?;

    Ok(import_result
        .resources
        .http_requests
        .get(0)
        .ok_or(GenericError("No curl command found".to_string()))
        .map(|r| {
            let mut request = r.clone();
            request.workspace_id = workspace_id.into();
            request.id = "".to_string();
            request
        })?)
}

#[tauri::command]
async fn cmd_export_data<R: Runtime>(
    app_handle: AppHandle<R>,
    export_path: &str,
    workspace_ids: Vec<&str>,
    include_private_environments: bool,
) -> YaakResult<()> {
    let export_data =
        get_workspace_export_resources(&app_handle, workspace_ids, include_private_environments)?;
    let f = File::options()
        .create(true)
        .truncate(true)
        .write(true)
        .open(export_path)
        .expect("Unable to create file");

    serde_json::to_writer_pretty(&f, &export_data)
        .map_err(|e| GenericError(e.to_string()))
        .expect("Failed to write");

    f.sync_all().expect("Failed to sync");

    Ok(())
}

#[tauri::command]
async fn cmd_save_response<R: Runtime>(
    app_handle: AppHandle<R>,
    response_id: &str,
    filepath: &str,
) -> YaakResult<()> {
    let response = app_handle.db().get_http_response(response_id)?;

    let body_path =
        response.body_path.ok_or(GenericError("Response does not have a body".to_string()))?;
    fs::copy(body_path, filepath).map_err(|e| GenericError(e.to_string()))?;

    Ok(())
}

#[tauri::command]
async fn cmd_send_http_request<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    environment_id: Option<&str>,
    cookie_jar_id: Option<&str>,
    // NOTE: We receive the entire request because to account for the race
    //   condition where the user may have just edited a field before sending
    //   that has not yet been saved in the DB.
    request: HttpRequest,
) -> YaakResult<HttpResponse> {
    let response = app_handle.db().upsert_http_response(
        &HttpResponse {
            request_id: request.id.clone(),
            workspace_id: request.workspace_id.clone(),
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )?;

    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    app_handle.listen_any(format!("cancel_http_response_{}", response.id), move |_event| {
        if let Err(e) = cancel_tx.send(true) {
            warn!("Failed to send cancel event for request {e:?}");
        }
    });

    let environment = match environment_id {
        Some(id) => match app_handle.db().get_environment(id) {
            Ok(env) => Some(env),
            Err(e) => {
                warn!("Failed to find environment by id {id} {}", e);
                None
            }
        },
        None => None,
    };

    let cookie_jar = match cookie_jar_id {
        Some(id) => Some(app_handle.db().get_cookie_jar(id)?),
        None => None,
    };

    let r = match send_http_request(
        &window,
        &request,
        &response,
        environment,
        cookie_jar,
        &mut cancel_rx,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            let resp = app_handle.db().get_http_response(&response.id)?;
            app_handle.db().upsert_http_response(
                &HttpResponse {
                    state: HttpResponseState::Closed,
                    error: Some(e.to_string()),
                    ..resp
                },
                &UpdateSource::from_window(&window),
            )?
        }
    };

    Ok(r)
}

fn response_err<R: Runtime>(
    app_handle: &AppHandle<R>,
    response: &HttpResponse,
    error: String,
    update_source: &UpdateSource,
) -> HttpResponse {
    warn!("Failed to send request: {error:?}");
    let mut response = response.clone();
    response.state = HttpResponseState::Closed;
    response.error = Some(error.clone());
    response = app_handle
        .db()
        .update_http_response_if_id(&response, update_source)
        .expect("Failed to update response");
    response
}

#[tauri::command]
async fn cmd_install_plugin<R: Runtime>(
    directory: &str,
    url: Option<String>,
    plugin_manager: State<'_, PluginManager>,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Plugin> {
    plugin_manager.add_plugin_by_dir(&PluginWindowContext::new(&window), &directory).await?;

    Ok(app_handle.db().upsert_plugin(
        &Plugin {
            directory: directory.into(),
            url,
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )?)
}

#[tauri::command]
async fn cmd_create_grpc_request<R: Runtime>(
    workspace_id: &str,
    name: &str,
    sort_priority: f32,
    folder_id: Option<&str>,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<GrpcRequest> {
    Ok(app_handle.db().upsert_grpc_request(
        &GrpcRequest {
            workspace_id: workspace_id.to_string(),
            name: name.to_string(),
            folder_id: folder_id.map(|s| s.to_string()),
            sort_priority,
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )?)
}

#[tauri::command]
async fn cmd_reload_plugins<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<()> {
    plugin_manager.initialize_all_plugins(&app_handle, &PluginWindowContext::new(&window)).await?;
    Ok(())
}

#[tauri::command]
async fn cmd_plugin_info<R: Runtime>(
    id: &str,
    app_handle: AppHandle<R>,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<PluginMetadata> {
    let plugin = app_handle.db().get_plugin(id)?;
    Ok(plugin_manager
        .get_plugin_by_dir(plugin.directory.as_str())
        .await
        .ok_or(GenericError("Failed to find plugin for info".to_string()))?
        .info())
}

#[tauri::command]
async fn cmd_delete_all_grpc_connections<R: Runtime>(
    request_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<()> {
    Ok(app_handle
        .db()
        .delete_all_grpc_connections_for_request(request_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_delete_send_history<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<()> {
    Ok(app_handle.with_tx(|tx| {
        let source = &UpdateSource::from_window(&window);
        tx.delete_all_http_responses_for_workspace(workspace_id, source)?;
        tx.delete_all_grpc_connections_for_workspace(workspace_id, source)?;
        tx.delete_all_websocket_connections_for_workspace(workspace_id, source)?;
        Ok(())
    })?)
}

#[tauri::command]
async fn cmd_delete_all_http_responses<R: Runtime>(
    request_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<()> {
    Ok(app_handle
        .db()
        .delete_all_http_responses_for_request(request_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_get_workspace_meta<R: Runtime>(
    app_handle: AppHandle<R>,
    workspace_id: &str,
) -> YaakResult<WorkspaceMeta> {
    let db = app_handle.db();
    let workspace = db.get_workspace(workspace_id)?;
    Ok(db.get_or_create_workspace_meta(&workspace.id)?)
}

#[tauri::command]
async fn cmd_new_child_window(
    parent_window: WebviewWindow,
    url: &str,
    label: &str,
    title: &str,
    inner_size: (f64, f64),
) -> YaakResult<()> {
    window::create_child_window(&parent_window, url, label, title, inner_size);
    Ok(())
}

#[tauri::command]
async fn cmd_new_main_window(app_handle: AppHandle, url: &str) -> YaakResult<()> {
    window::create_main_window(&app_handle, url);
    Ok(())
}

#[tauri::command]
async fn cmd_check_for_updates<R: Runtime>(
    window: WebviewWindow<R>,
    yaak_updater: State<'_, Mutex<YaakUpdater>>,
) -> YaakResult<bool> {
    let update_mode = get_update_mode(&window).await?;
    Ok(yaak_updater.lock().await.check_now(&window, update_mode, UpdateTrigger::User).await?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(
            Builder::default()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .level_for("plugin_runtime", log::LevelFilter::Info)
                .level_for("cookie_store", log::LevelFilter::Info)
                .level_for("eventsource_client::event_parser", log::LevelFilter::Info)
                .level_for("h2", log::LevelFilter::Info)
                .level_for("hyper", log::LevelFilter::Info)
                .level_for("hyper_util", log::LevelFilter::Info)
                .level_for("hyper_rustls", log::LevelFilter::Info)
                .level_for("reqwest", log::LevelFilter::Info)
                .level_for("sqlx", log::LevelFilter::Debug)
                .level_for("tao", log::LevelFilter::Info)
                .level_for("tokio_util", log::LevelFilter::Info)
                .level_for("tonic", log::LevelFilter::Info)
                .level_for("tower", log::LevelFilter::Info)
                .level_for("tracing", log::LevelFilter::Warn)
                .level_for("swc_ecma_codegen", log::LevelFilter::Off)
                .level_for("swc_ecma_transforms_base", log::LevelFilter::Off)
                .with_colors(ColoredLevelConfig::default())
                .level(if is_dev() { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When trying to open a new app instance (common operation on Linux),
            // focus the first existing window we find instead of opening a new one
            // TODO: Keep track of the last focused window and always focus that one
            if let Some(window) = app.webview_windows().values().next() {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(yaak_license::init())
        .plugin(yaak_mac_window::init())
        .plugin(yaak_models::init())
        .plugin(yaak_plugins::init())
        .plugin(yaak_crypto::init())
        .plugin(yaak_fonts::init())
        .plugin(yaak_git::init())
        .plugin(yaak_ws::init())
        .plugin(yaak_sync::init());

    builder
        .setup(|app| {
            {
                let app_handle = app.app_handle().clone();
                app.deep_link().on_open_url(move |event| {
                    info!("Handling deep link open");
                    let app_handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        for url in event.urls() {
                            if let Err(e) = handle_deep_link(&app_handle, &url).await {
                                warn!("Failed to handle deep link {}: {e:?}", url.to_string());
                                let _ = app_handle.emit(
                                    "show_toast",
                                    ShowToastRequest {
                                        message: format!(
                                            "Error handling deep link: {}",
                                            e.to_string()
                                        ),
                                        color: Some(Color::Danger),
                                        icon: None,
                                    },
                                );
                            };
                        }
                    });
                });
            };

            let app_data_dir = app.path().app_data_dir().unwrap();
            create_dir_all(app_data_dir.clone()).expect("Problem creating App directory!");

            // Add updater
            let yaak_updater = YaakUpdater::new();
            app.manage(Mutex::new(yaak_updater));

            // Add notifier
            let yaak_notifier = YaakNotifier::new();
            app.manage(Mutex::new(yaak_notifier));

            // Add GRPC manager
            let grpc_handle = GrpcHandle::new(&app.app_handle());
            app.manage(Mutex::new(grpc_handle));

            monitor_plugin_events(&app.app_handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_call_http_authentication_action,
            cmd_call_http_request_action,
            cmd_call_grpc_request_action,
            cmd_check_for_updates,
            cmd_create_grpc_request,
            cmd_curl_to_request,
            cmd_delete_all_grpc_connections,
            cmd_delete_all_http_responses,
            cmd_delete_send_history,
            cmd_dismiss_notification,
            cmd_export_data,
            cmd_filter_response,
            cmd_format_json,
            cmd_get_http_authentication_summaries,
            cmd_get_http_authentication_config,
            cmd_get_sse_events,
            cmd_get_workspace_meta,
            cmd_grpc_go,
            cmd_grpc_reflect,
            cmd_grpc_request_actions,
            cmd_http_request_actions,
            cmd_import_data,
            cmd_install_plugin,
            cmd_metadata,
            cmd_new_child_window,
            cmd_new_main_window,
            cmd_plugin_info,
            cmd_reload_plugins,
            cmd_render_template,
            cmd_save_response,
            cmd_send_ephemeral_request,
            cmd_send_http_request,
            cmd_template_functions,
            cmd_template_tokens_to_string,
            //
            //
            // Migrated commands
            crate::commands::cmd_decrypt_template,
            crate::commands::cmd_get_themes,
            crate::commands::cmd_secure_template,
            crate::commands::cmd_show_workspace_key,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            match event {
                RunEvent::Ready => {
                    let _ = window::create_main_window(app_handle, "/");
                    let h = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let info = history::store_launch_history(&h).await;
                        debug!("Launched Yaak {:?}", info);
                    });

                    // Cancel pending requests
                    let h = app_handle.clone();
                    tauri::async_runtime::block_on(async move {
                        let db = h.db();
                        let _ = db.cancel_pending_http_responses();
                        let _ = db.cancel_pending_grpc_connections();
                        let _ = db.cancel_pending_websocket_connections();
                    });
                }
                RunEvent::WindowEvent {
                    event: WindowEvent::Focused(true),
                    label,
                    ..
                } => {
                    let w = app_handle.get_webview_window(&label).unwrap();
                    let h = app_handle.clone();

                    // Run update check whenever the window is focused
                    tauri::async_runtime::spawn(async move {
                        if w.db().get_settings().autoupdate {
                            let val: State<'_, Mutex<YaakUpdater>> = h.state();
                            let update_mode = get_update_mode(&w).await.unwrap();
                            if let Err(e) = val.lock().await.maybe_check(&w, update_mode).await {
                                warn!("Failed to check for updates {e:?}");
                            };
                        };
                    });

                    let h = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let windows = h.webview_windows();
                        let w = windows.values().next().unwrap();
                        tokio::time::sleep(Duration::from_millis(4000)).await;
                        let val: State<'_, Mutex<YaakNotifier>> = w.state();
                        let mut n = val.lock().await;
                        if let Err(e) = n.maybe_check(&w).await {
                            warn!("Failed to check for notifications {}", e)
                        }
                    });
                }
                RunEvent::WindowEvent {
                    event: WindowEvent::CloseRequested { .. },
                    ..
                } => {
                    if let Err(e) = app_handle.save_window_state(StateFlags::all()) {
                        warn!("Failed to save window state {e:?}");
                    } else {
                        info!("Saved window state");
                    };
                }
                _ => {}
            };
        });
}

async fn get_update_mode<R: Runtime>(window: &WebviewWindow<R>) -> YaakResult<UpdateMode> {
    let settings = window.db().get_settings();
    Ok(UpdateMode::new(settings.update_channel.as_str()))
}

fn safe_uri(endpoint: &str) -> String {
    if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        endpoint.into()
    } else {
        format!("http://{}", endpoint)
    }
}

fn monitor_plugin_events<R: Runtime>(app_handle: &AppHandle<R>) {
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let plugin_manager: State<'_, PluginManager> = app_handle.state();
        let (rx_id, mut rx) = plugin_manager.subscribe("app").await;

        while let Some(event) = rx.recv().await {
            let app_handle = app_handle.clone();
            let plugin =
                match plugin_manager.get_plugin_by_ref_id(event.plugin_ref_id.as_str()).await {
                    None => {
                        warn!("Failed to get plugin for event {:?}", event);
                        continue;
                    }
                    Some(p) => p,
                };

            // We might have recursive back-and-forth calls between app and plugin, so we don't
            // want to block here
            tauri::async_runtime::spawn(async move {
                plugin_events::handle_plugin_event(&app_handle, &event, &plugin).await;
            });
        }
        plugin_manager.unsubscribe(rx_id.as_str()).await;
    });
}

async fn call_frontend<R: Runtime>(
    window: WebviewWindow<R>,
    event: &InternalEvent,
) -> Option<InternalEventPayload> {
    window.emit_to(window.label(), "plugin_event", event.clone()).unwrap();
    let (tx, mut rx) = tokio::sync::watch::channel(None);

    let reply_id = event.id.clone();
    let event_id = window.clone().listen(reply_id, move |ev| {
        let resp: InternalEvent = serde_json::from_str(ev.payload()).unwrap();
        if let Err(e) = tx.send(Some(resp.payload)) {
            warn!("Failed to prompt for text {e:?}");
        }
    });

    // When reply shows up, unlisten to events and return
    if let Err(e) = rx.changed().await {
        warn!("Failed to check channel changed {e:?}");
    }
    window.unlisten(event_id);

    let v = rx.borrow();
    v.to_owned()
}

fn get_window_from_window_context<R: Runtime>(
    app_handle: &AppHandle<R>,
    window_context: &PluginWindowContext,
) -> Option<WebviewWindow<R>> {
    let label = match window_context {
        PluginWindowContext::Label { label, .. } => label,
        PluginWindowContext::None => {
            return app_handle.webview_windows().iter().next().map(|(_, w)| w.to_owned());
        }
    };

    let window = app_handle
        .webview_windows()
        .iter()
        .find_map(|(_, w)| if w.label() == label { Some(w.to_owned()) } else { None });

    if window.is_none() {
        error!("Failed to find window by {window_context:?}");
    }

    window
}

fn workspace_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<Workspace> {
    window.workspace_id().and_then(|id| window.db().get_workspace(&id).ok())
}

fn environment_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<Environment> {
    window.environment_id().and_then(|id| window.db().get_environment(&id).ok())
}

fn cookie_jar_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<CookieJar> {
    window.cookie_jar_id().and_then(|id| window.db().get_cookie_jar(&id).ok())
}
