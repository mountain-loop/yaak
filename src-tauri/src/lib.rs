extern crate core;
#[cfg(target_os = "macos")]
extern crate objc;
use crate::encoding::read_response_body;
use crate::error::Error::GenericError;
use crate::grpc::metadata_to_map;
use crate::http_request::send_http_request;
use crate::notifications::YaakNotifier;
use crate::render::{render_grpc_request, render_template};
use crate::updates::{UpdateMode, UpdateTrigger, YaakUpdater};
use crate::uri_scheme::handle_uri_scheme;
use error::Result as YaakResult;
use eventsource_client::{EventParser, SSE};
use log::{debug, error, warn};
use regex::Regex;
use std::collections::{BTreeMap, HashMap};
use std::fs::{create_dir_all, File};
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;
use std::{fs, panic};
use tauri::{is_dev, AppHandle, Emitter, RunEvent, State, WebviewWindow};
use tauri::{Listener, Runtime};
use tauri::{Manager, WindowEvent};
use tauri_plugin_log::fern::colors::ColoredLevelConfig;
use tauri_plugin_log::{Builder, Target, TargetKind};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use tokio::fs::read_to_string;
use tokio::sync::Mutex;
use tokio::task::block_in_place;
use yaak_grpc::manager::{DynamicMessage, GrpcHandle};
use yaak_grpc::{deserialize_message, serialize_message, Code, ServiceDefinition};
use yaak_models::models::{
    CookieJar, Environment, EnvironmentVariable, Folder, GrpcConnection, GrpcConnectionState,
    GrpcEvent, GrpcEventType, GrpcRequest, HttpRequest, HttpResponse, HttpResponseState, KeyValue,
    ModelType, Plugin, Settings, WebsocketRequest, Workspace, WorkspaceMeta,
};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::{
    generate_model_id, get_workspace_export_resources, BatchUpsertResult, UpdateSource,
};
use yaak_plugins::events::{
    BootResponse, CallHttpAuthenticationRequest, CallHttpRequestActionRequest, FilterResponse,
    GetHttpAuthenticationConfigResponse, GetHttpAuthenticationSummaryResponse,
    GetHttpRequestActionsResponse, GetTemplateFunctionsResponse, HttpHeader, InternalEvent,
    InternalEventPayload, JsonPrimitive, RenderPurpose, WindowContext,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_sse::sse::ServerSentEvent;
use yaak_templates::format::format_json;
use yaak_templates::{Parser, Tokens};

mod encoding;
mod error;
mod grpc;
mod history;
mod http_request;
mod notifications;
mod plugin_events;
mod render;
#[cfg(target_os = "macos")]
mod tauri_plugin_mac_window;
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
async fn cmd_metadata(app_handle: AppHandle) -> Result<AppMetaData, ()> {
    let app_data_dir = app_handle.path().app_data_dir().unwrap();
    let app_log_dir = app_handle.path().app_log_dir().unwrap();
    Ok(AppMetaData {
        is_dev: is_dev(),
        version: app_handle.package_info().version.to_string(),
        name: app_handle.package_info().name.to_string(),
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
        app_log_dir: app_log_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn cmd_parse_template(template: &str) -> YaakResult<Tokens> {
    Ok(Parser::new(template).parse()?)
}

#[tauri::command]
async fn cmd_template_tokens_to_string(tokens: Tokens) -> Result<String, String> {
    Ok(tokens.to_string())
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
            &WindowContext::from_window(&window),
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
) -> Result<(), String> {
    yaak_notifier.lock().await.seen(&window, notification_id).await
}

#[tauri::command]
async fn cmd_grpc_reflect<R: Runtime>(
    request_id: &str,
    proto_files: Vec<String>,
    app_handle: AppHandle<R>,
    grpc_handle: State<'_, Mutex<GrpcHandle>>,
) -> YaakResult<Vec<ServiceDefinition>> {
    let req = app_handle.db().get_grpc_request(request_id)?;

    let uri = safe_uri(&req.url);

    Ok(grpc_handle
        .lock()
        .await
        .services(
            &req.id,
            &uri,
            &proto_files.iter().map(|p| PathBuf::from_str(p).unwrap()).collect(),
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
    plugin_manager: State<'_, PluginManager>,
    grpc_handle: State<'_, Mutex<GrpcHandle>>,
) -> YaakResult<String> {
    let environment = match environment_id {
        Some(id) => app_handle.db().get_environment(id).ok(),
        None => None,
    };
    let unrendered_request = app_handle.db().get_grpc_request(request_id)?;
    let base_environment =
        app_handle.db().get_base_environment(&unrendered_request.workspace_id)?;
    let request = render_grpc_request(
        &unrendered_request,
        &base_environment,
        environment.as_ref(),
        &PluginTemplateCallback::new(
            &app_handle,
            &WindowContext::from_window(&window),
            RenderPurpose::Send,
        ),
    )
    .await?;
    let mut metadata = BTreeMap::new();

    // Add the rest of metadata
    for h in request.clone().metadata {
        if h.name.is_empty() && h.value.is_empty() {
            continue;
        }

        if !h.enabled {
            continue;
        }

        metadata.insert(h.name, h.value);
    }

    if let Some(auth_name) = request.authentication_type.clone() {
        let auth = request.authentication.clone();
        let plugin_req = CallHttpAuthenticationRequest {
            context_id: format!("{:x}", md5::compute(request_id.to_string())),
            values: serde_json::from_value(serde_json::to_value(&auth).unwrap()).unwrap(),
            method: "POST".to_string(),
            url: request.url.clone(),
            headers: metadata
                .iter()
                .map(|(name, value)| HttpHeader {
                    name: name.to_string(),
                    value: value.to_string(),
                })
                .collect(),
        };
        let plugin_result =
            plugin_manager.call_http_authentication(&window, &auth_name, plugin_req).await?;
        for header in plugin_result.set_headers {
            metadata.insert(header.name, header.value);
        }
    }

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
        let workspace = base_environment.clone();
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
                                &workspace,
                                environment.as_ref(),
                                &PluginTemplateCallback::new(
                                    &app_handle,
                                    &WindowContext::from_window(&window),
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
                &WindowContext::from_window(&window),
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
                            connection.streaming(&service, &method, in_msg_stream, metadata).await,
                        ),
                        None,
                    ),
                    (true, false) => (
                        None,
                        Some(
                            connection
                                .client_streaming(&service, &method, in_msg_stream, metadata)
                                .await,
                        ),
                    ),
                    (false, true) => (
                        Some(connection.server_streaming(&service, &method, &msg, metadata).await),
                        None,
                    ),
                    (false, false) => {
                        (None, Some(connection.unary(&service, &method, &msg, metadata).await))
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
async fn cmd_format_json(text: &str) -> Result<String, String> {
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
async fn cmd_get_sse_events(file_path: &str) -> Result<Vec<ServerSentEvent>, String> {
    let body = fs::read(file_path).map_err(|e| e.to_string())?;
    let mut event_parser = EventParser::new();
    event_parser.process_bytes(body.into()).map_err(|e| e.to_string())?;

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
    app_handle: AppHandle<R>,
    plugin_manager: State<'_, PluginManager>,
    file_path: &str,
) -> YaakResult<BatchUpsertResult> {
    let file = read_to_string(file_path)
        .await
        .unwrap_or_else(|_| panic!("Unable to read file {}", file_path));
    let file_contents = file.as_str();
    let import_result = plugin_manager.import_data(&window, file_contents).await?;

    let mut id_map: BTreeMap<String, String> = BTreeMap::new();

    fn maybe_gen_id(id: &str, model: ModelType, ids: &mut BTreeMap<String, String>) -> String {
        if !id.starts_with("GENERATE_ID::") {
            return id.to_string();
        }

        let unique_key = id.replace("GENERATE_ID", "");
        if let Some(existing) = ids.get(unique_key.as_str()) {
            existing.to_string()
        } else {
            let new_id = generate_model_id(model);
            ids.insert(unique_key, new_id.clone());
            new_id
        }
    }

    fn maybe_gen_id_opt(
        id: Option<String>,
        model: ModelType,
        ids: &mut BTreeMap<String, String>,
    ) -> Option<String> {
        match id {
            Some(id) => Some(maybe_gen_id(id.as_str(), model, ids)),
            None => None,
        }
    }

    let resources = import_result.resources;

    let workspaces: Vec<Workspace> = resources
        .workspaces
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id(v.id.as_str(), ModelType::TypeWorkspace, &mut id_map);
            v
        })
        .collect();

    let environments: Vec<Environment> = resources
        .environments
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id(v.id.as_str(), ModelType::TypeEnvironment, &mut id_map);
            v.workspace_id =
                maybe_gen_id(v.workspace_id.as_str(), ModelType::TypeWorkspace, &mut id_map);
            v.environment_id =
                maybe_gen_id_opt(v.environment_id, ModelType::TypeEnvironment, &mut id_map);
            v
        })
        .collect();

    let folders: Vec<Folder> = resources
        .folders
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id(v.id.as_str(), ModelType::TypeFolder, &mut id_map);
            v.workspace_id =
                maybe_gen_id(v.workspace_id.as_str(), ModelType::TypeWorkspace, &mut id_map);
            v.folder_id = maybe_gen_id_opt(v.folder_id, ModelType::TypeFolder, &mut id_map);
            v
        })
        .collect();

    let http_requests: Vec<HttpRequest> = resources
        .http_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id(v.id.as_str(), ModelType::TypeHttpRequest, &mut id_map);
            v.workspace_id =
                maybe_gen_id(v.workspace_id.as_str(), ModelType::TypeWorkspace, &mut id_map);
            v.folder_id = maybe_gen_id_opt(v.folder_id, ModelType::TypeFolder, &mut id_map);
            v
        })
        .collect();

    let grpc_requests: Vec<GrpcRequest> = resources
        .grpc_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id(v.id.as_str(), ModelType::TypeGrpcRequest, &mut id_map);
            v.workspace_id =
                maybe_gen_id(v.workspace_id.as_str(), ModelType::TypeWorkspace, &mut id_map);
            v.folder_id = maybe_gen_id_opt(v.folder_id, ModelType::TypeFolder, &mut id_map);
            v
        })
        .collect();

    let websocket_requests: Vec<WebsocketRequest> = resources
        .websocket_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id(v.id.as_str(), ModelType::TypeWebsocketRequest, &mut id_map);
            v.workspace_id =
                maybe_gen_id(v.workspace_id.as_str(), ModelType::TypeWorkspace, &mut id_map);
            v.folder_id = maybe_gen_id_opt(v.folder_id, ModelType::TypeFolder, &mut id_map);
            v
        })
        .collect();

    let upserted = app_handle.with_tx(|tx| {
        tx.batch_upsert(
            workspaces,
            environments,
            folders,
            http_requests,
            grpc_requests,
            websocket_requests,
            &UpdateSource::Import,
        )
    })?;

    Ok(upserted)
}

#[tauri::command]
async fn cmd_http_request_actions<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> Result<Vec<GetHttpRequestActionsResponse>, String> {
    plugin_manager.get_http_request_actions(&window).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_template_functions<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> Result<Vec<GetTemplateFunctionsResponse>, String> {
    plugin_manager.get_template_functions(&window).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_get_http_authentication_summaries<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> Result<Vec<GetHttpAuthenticationSummaryResponse>, String> {
    let results = plugin_manager
        .get_http_authentication_summaries(&window)
        .await
        .map_err(|e| e.to_string())?;
    Ok(results.into_iter().map(|(_, a)| a).collect())
}

#[tauri::command]
async fn cmd_get_http_authentication_config<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
    auth_name: &str,
    values: HashMap<String, JsonPrimitive>,
    request_id: &str,
) -> Result<GetHttpAuthenticationConfigResponse, String> {
    plugin_manager
        .get_http_authentication_config(&window, auth_name, values, request_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_call_http_request_action<R: Runtime>(
    window: WebviewWindow<R>,
    req: CallHttpRequestActionRequest,
    plugin_manager: State<'_, PluginManager>,
) -> Result<(), String> {
    plugin_manager.call_http_request_action(&window, req).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_call_http_authentication_action<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
    auth_name: &str,
    action_index: i32,
    values: HashMap<String, JsonPrimitive>,
    request_id: &str,
) -> Result<(), String> {
    plugin_manager
        .call_http_authentication_action(&window, auth_name, action_index, values, request_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_curl_to_request<R: Runtime>(
    window: WebviewWindow<R>,
    command: &str,
    plugin_manager: State<'_, PluginManager>,
    workspace_id: &str,
) -> Result<HttpRequest, String> {
    let import_result =
        { plugin_manager.import_data(&window, command).await.map_err(|e| e.to_string())? };

    import_result.resources.http_requests.get(0).ok_or("No curl command found".to_string()).map(
        |r| {
            let mut request = r.clone();
            request.workspace_id = workspace_id.into();
            request.id = "".to_string();
            request
        },
    )
}

#[tauri::command]
async fn cmd_export_data<R: Runtime>(
    app_handle: AppHandle<R>,
    export_path: &str,
    workspace_ids: Vec<&str>,
    include_environments: bool,
) -> Result<(), String> {
    let export_data =
        get_workspace_export_resources(&app_handle, workspace_ids, include_environments)
            .await
            .map_err(|e| e.to_string())?;
    let f = File::options()
        .create(true)
        .truncate(true)
        .write(true)
        .open(export_path)
        .expect("Unable to create file");

    serde_json::to_writer_pretty(&f, &export_data)
        .map_err(|e| e.to_string())
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

    send_http_request(&window, &request, &response, environment, cookie_jar, &mut cancel_rx).await
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
async fn cmd_set_update_mode<R: Runtime>(
    update_mode: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<KeyValue> {
    let (key_value, _created) = app_handle.db().set_key_value_raw(
        "app",
        "update_mode",
        update_mode,
        &UpdateSource::from_window(&window),
    );
    Ok(key_value)
}

#[tauri::command]
async fn cmd_get_key_value<R: Runtime>(
    namespace: &str,
    key: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Option<KeyValue>> {
    Ok(app_handle.db().get_key_value_raw(namespace, key))
}

#[tauri::command]
async fn cmd_set_key_value<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    namespace: &str,
    key: &str,
    value: &str,
) -> YaakResult<KeyValue> {
    let (key_value, _created) = app_handle.db().set_key_value_raw(
        namespace,
        key,
        value,
        &UpdateSource::from_window(&window),
    );
    Ok(key_value)
}

#[tauri::command]
async fn cmd_install_plugin<R: Runtime>(
    directory: &str,
    url: Option<String>,
    plugin_manager: State<'_, PluginManager>,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Plugin> {
    plugin_manager
        .add_plugin_by_dir(&WindowContext::from_window(&window), &directory, true)
        .await?;

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
async fn cmd_uninstall_plugin<R: Runtime>(
    plugin_id: &str,
    plugin_manager: State<'_, PluginManager>,
    window: WebviewWindow<R>,
    app_handle: AppHandle<R>,
) -> YaakResult<Plugin> {
    let plugin =
        app_handle.db().delete_plugin_by_id(plugin_id, &UpdateSource::from_window(&window))?;

    plugin_manager
        .uninstall(&WindowContext::from_window(&window), plugin.directory.as_str())
        .await?;

    Ok(plugin)
}

#[tauri::command]
async fn cmd_update_cookie_jar<R: Runtime>(
    cookie_jar: CookieJar,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<CookieJar> {
    Ok(app_handle.db().upsert_cookie_jar(&cookie_jar, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_delete_cookie_jar<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    cookie_jar_id: &str,
) -> YaakResult<CookieJar> {
    Ok(app_handle
        .db()
        .delete_cookie_jar_by_id(cookie_jar_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_create_cookie_jar<R: Runtime>(
    workspace_id: &str,
    name: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<CookieJar> {
    Ok(app_handle.db().upsert_cookie_jar(
        &CookieJar {
            name: name.to_string(),
            workspace_id: workspace_id.to_string(),
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )?)
}

#[tauri::command]
async fn cmd_create_environment<R: Runtime>(
    workspace_id: &str,
    environment_id: Option<&str>,
    name: &str,
    variables: Vec<EnvironmentVariable>,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Environment> {
    Ok(app_handle.db().upsert_environment(
        &Environment {
            workspace_id: workspace_id.to_string(),
            environment_id: environment_id.map(|s| s.to_string()),
            name: name.to_string(),
            variables,
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
async fn cmd_duplicate_grpc_request<R: Runtime>(
    id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<GrpcRequest> {
    let db = app_handle.db();
    let request = db.get_grpc_request(id)?;
    Ok(db.duplicate_grpc_request(&request, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_duplicate_folder<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    id: &str,
) -> YaakResult<Folder> {
    let db = app_handle.db();
    let folder = db.get_folder(id)?;
    Ok(db.duplicate_folder(&folder, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_duplicate_http_request<R: Runtime>(
    id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<HttpRequest> {
    let db = app_handle.db();
    let request = db.get_http_request(id)?;
    Ok(db.duplicate_http_request(&request, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_update_workspace<R: Runtime>(
    workspace: Workspace,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Workspace> {
    Ok(app_handle.db().upsert_workspace(&workspace, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_update_workspace_meta<R: Runtime>(
    workspace_meta: WorkspaceMeta,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<WorkspaceMeta> {
    Ok(app_handle
        .db()
        .upsert_workspace_meta(&workspace_meta, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_update_environment<R: Runtime>(
    environment: Environment,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Environment> {
    Ok(app_handle.db().upsert_environment(&environment, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_update_grpc_request<R: Runtime>(
    request: GrpcRequest,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<GrpcRequest> {
    Ok(app_handle.db().upsert_grpc_request(&request, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_upsert_http_request<R: Runtime>(
    request: HttpRequest,
    window: WebviewWindow<R>,
    app_handle: AppHandle<R>,
) -> YaakResult<HttpRequest> {
    Ok(app_handle.db().upsert(&request, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_delete_grpc_request<R: Runtime>(
    app_handle: AppHandle<R>,
    request_id: &str,
    window: WebviewWindow<R>,
) -> YaakResult<GrpcRequest> {
    Ok(app_handle
        .db()
        .delete_grpc_request_by_id(request_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_delete_http_request<R: Runtime>(
    app_handle: AppHandle<R>,
    request_id: &str,
    window: WebviewWindow<R>,
) -> YaakResult<HttpRequest> {
    Ok(app_handle
        .db()
        .delete_http_request_by_id(request_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_list_folders<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Vec<Folder>> {
    Ok(app_handle.db().list_folders(workspace_id)?)
}

#[tauri::command]
async fn cmd_update_folder<R: Runtime>(
    folder: Folder,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Folder> {
    Ok(app_handle.db().upsert_folder(&folder, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_delete_folder<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    folder_id: &str,
) -> YaakResult<Folder> {
    Ok(app_handle.db().delete_folder_by_id(folder_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_delete_environment<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    environment_id: &str,
) -> YaakResult<Environment> {
    Ok(app_handle
        .db()
        .delete_environment_by_id(environment_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_list_grpc_connections<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Vec<GrpcConnection>> {
    Ok(app_handle.db().list_grpc_connections_for_workspace(workspace_id, None)?)
}

#[tauri::command]
async fn cmd_list_grpc_events<R: Runtime>(
    connection_id: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Vec<GrpcEvent>> {
    Ok(app_handle.db().list_grpc_events(connection_id)?)
}

#[tauri::command]
async fn cmd_list_grpc_requests<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Vec<GrpcRequest>> {
    Ok(app_handle.db().list_grpc_requests(workspace_id)?)
}

#[tauri::command]
async fn cmd_list_http_requests<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Vec<HttpRequest>> {
    Ok(app_handle.db().list_http_requests(workspace_id)?)
}

#[tauri::command]
async fn cmd_list_environments<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Vec<Environment>> {
    // Not sure of a better place to put this...
    let db = app_handle.db();
    db.ensure_base_environment(workspace_id)?;
    Ok(db.list_environments(workspace_id)?)
}

#[tauri::command]
async fn cmd_list_plugins<R: Runtime>(app_handle: AppHandle<R>) -> YaakResult<Vec<Plugin>> {
    Ok(app_handle.db().list_plugins()?)
}

#[tauri::command]
async fn cmd_reload_plugins<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> Result<(), String> {
    plugin_manager
        .initialize_all_plugins(&app_handle, &WindowContext::from_window(&window))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn cmd_plugin_info<R: Runtime>(
    id: &str,
    app_handle: AppHandle<R>,
    plugin_manager: State<'_, PluginManager>,
) -> YaakResult<BootResponse> {
    let plugin = app_handle.db().get_plugin(id)?;
    Ok(plugin_manager
        .get_plugin_by_dir(plugin.directory.as_str())
        .await
        .ok_or(GenericError("Failed to find plugin for info".to_string()))?
        .info()
        .await)
}

#[tauri::command]
async fn cmd_get_settings<R: Runtime>(window: WebviewWindow<R>) -> YaakResult<Settings> {
    Ok(window.db().get_or_create_settings(&UpdateSource::from_window(&window)))
}

#[tauri::command]
async fn cmd_update_settings<R: Runtime>(
    settings: Settings,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Settings> {
    Ok(app_handle.db().upsert_settings(&settings, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_get_folder<R: Runtime>(id: &str, app_handle: AppHandle<R>) -> YaakResult<Folder> {
    Ok(app_handle.db().get_folder(id)?)
}

#[tauri::command]
async fn cmd_list_cookie_jars<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Vec<CookieJar>> {
    let db = app_handle.db();
    let cookie_jars = db.list_cookie_jars(workspace_id)?;

    if cookie_jars.is_empty() {
        let cookie_jar = db.upsert_cookie_jar(
            &CookieJar {
                name: "Default".to_string(),
                workspace_id: workspace_id.to_string(),
                ..Default::default()
            },
            &UpdateSource::from_window(&window),
        )?;
        Ok(vec![cookie_jar])
    } else {
        Ok(cookie_jars)
    }
}

#[tauri::command]
async fn cmd_list_key_values<R: Runtime>(app_handle: AppHandle<R>) -> YaakResult<Vec<KeyValue>> {
    Ok(app_handle.db().list_key_values_raw()?)
}

#[tauri::command]
async fn cmd_get_environment<R: Runtime>(
    id: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Environment> {
    Ok(app_handle.db().get_environment(id)?)
}

#[tauri::command]
async fn cmd_get_workspace<R: Runtime>(
    id: &str,
    app_handle: AppHandle<R>,
) -> YaakResult<Workspace> {
    Ok(app_handle.db().get_workspace(id)?)
}

#[tauri::command]
async fn cmd_list_http_responses<R: Runtime>(
    workspace_id: &str,
    limit: Option<i64>,
    app_handle: AppHandle<R>,
) -> YaakResult<Vec<HttpResponse>> {
    Ok(app_handle.db().list_http_responses_for_workspace(workspace_id, limit.map(|l| l as u64))?)
}

#[tauri::command]
async fn cmd_delete_http_response<R: Runtime>(
    id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<HttpResponse> {
    let db = app_handle.db();
    let http_response = db.get_http_response(id)?;
    Ok(db.delete_http_response(&http_response, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_delete_grpc_connection<R: Runtime>(
    id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<GrpcConnection> {
    Ok(app_handle.db().delete_grpc_connection_by_id(id, &UpdateSource::from_window(&window))?)
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
async fn cmd_list_workspaces<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> YaakResult<Vec<Workspace>> {
    let queries = app_handle.db();
    let workspaces = queries.find_all::<Workspace>()?;
    if workspaces.is_empty() {
        let workspace = queries.upsert_workspace(
            &Workspace {
                name: "Yaak".to_string(),
                setting_follow_redirects: true,
                setting_validate_certificates: true,
                ..Default::default()
            },
            &UpdateSource::from_window(&window),
        )?;
        Ok(vec![workspace])
    } else {
        Ok(workspaces)
    }
}

#[tauri::command]
async fn cmd_get_workspace_meta<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> YaakResult<WorkspaceMeta> {
    let db = app_handle.db();
    let workspace = db.get_workspace(workspace_id)?;
    Ok(db.get_or_create_workspace_meta(&workspace, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
async fn cmd_new_child_window(
    parent_window: WebviewWindow,
    url: &str,
    label: &str,
    title: &str,
    inner_size: (f64, f64),
) -> Result<(), String> {
    window::create_child_window(&parent_window, url, label, title, inner_size);
    Ok(())
}

#[tauri::command]
async fn cmd_new_main_window(app_handle: AppHandle, url: &str) -> Result<(), String> {
    window::create_main_window(&app_handle, url);
    Ok(())
}

#[tauri::command]
async fn cmd_delete_workspace<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> YaakResult<Workspace> {
    Ok(app_handle.db().delete_workspace_by_id(workspace_id, &UpdateSource::from_window(&window))?)
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
                .level_for("sqlx", log::LevelFilter::Warn)
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(yaak_license::init())
        .plugin(yaak_models::init())
        .plugin(yaak_plugins::init())
        .plugin(yaak_git::init())
        .plugin(yaak_ws::init())
        .plugin(yaak_sync::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_mac_window::init());
    }

    builder
        .setup(|app| {
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
            cmd_check_for_updates,
            cmd_create_cookie_jar,
            cmd_create_environment,
            cmd_create_grpc_request,
            cmd_curl_to_request,
            cmd_delete_all_grpc_connections,
            cmd_delete_all_http_responses,
            cmd_delete_cookie_jar,
            cmd_delete_environment,
            cmd_delete_folder,
            cmd_delete_grpc_connection,
            cmd_delete_grpc_request,
            cmd_delete_http_request,
            cmd_delete_http_response,
            cmd_delete_send_history,
            cmd_delete_workspace,
            cmd_dismiss_notification,
            cmd_duplicate_folder,
            cmd_duplicate_grpc_request,
            cmd_duplicate_http_request,
            cmd_export_data,
            cmd_filter_response,
            cmd_format_json,
            cmd_get_environment,
            cmd_get_folder,
            cmd_get_http_authentication_summaries,
            cmd_get_http_authentication_config,
            cmd_get_key_value,
            cmd_get_settings,
            cmd_get_sse_events,
            cmd_get_workspace,
            cmd_get_workspace_meta,
            cmd_grpc_go,
            cmd_grpc_reflect,
            cmd_http_request_actions,
            cmd_import_data,
            cmd_install_plugin,
            cmd_list_cookie_jars,
            cmd_list_environments,
            cmd_list_folders,
            cmd_list_grpc_connections,
            cmd_list_grpc_events,
            cmd_list_grpc_requests,
            cmd_list_key_values,
            cmd_list_http_requests,
            cmd_list_http_responses,
            cmd_list_plugins,
            cmd_list_workspaces,
            cmd_metadata,
            cmd_new_child_window,
            cmd_new_main_window,
            cmd_parse_template,
            cmd_plugin_info,
            cmd_reload_plugins,
            cmd_render_template,
            cmd_save_response,
            cmd_send_ephemeral_request,
            cmd_send_http_request,
            cmd_set_key_value,
            cmd_set_update_mode,
            cmd_template_functions,
            cmd_template_tokens_to_string,
            cmd_uninstall_plugin,
            cmd_update_cookie_jar,
            cmd_update_environment,
            cmd_update_folder,
            cmd_update_grpc_request,
            cmd_upsert_http_request,
            cmd_update_settings,
            cmd_update_workspace,
            cmd_update_workspace_meta,
        ])
        .register_uri_scheme_protocol("yaak", handle_uri_scheme)
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
                        let val: State<'_, Mutex<YaakUpdater>> = h.state();
                        let update_mode = get_update_mode(&w).await.unwrap();
                        if let Err(e) = val.lock().await.maybe_check(&w, update_mode).await {
                            warn!("Failed to check for updates {e:?}");
                        };
                    });

                    let h = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let windows = h.webview_windows();
                        let w = windows.values().next().unwrap();
                        tokio::time::sleep(Duration::from_millis(4000)).await;
                        let val: State<'_, Mutex<YaakNotifier>> = w.state();
                        let mut n = val.lock().await;
                        if let Err(e) = n.check(&w).await {
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
                        debug!("Saved window state");
                    };
                }
                _ => {}
            };
        });
}

async fn get_update_mode<R: Runtime>(window: &WebviewWindow<R>) -> YaakResult<UpdateMode> {
    let settings = window.db().get_or_create_settings(&UpdateSource::from_window(window));
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
    window_context: &WindowContext,
) -> Option<WebviewWindow<R>> {
    let label = match window_context {
        WindowContext::Label { label } => label,
        WindowContext::None => {
            return app_handle.webview_windows().iter().next().map(|(_, w)| w.to_owned());
        }
    };

    let window = app_handle.webview_windows().iter().find_map(|(_, w)| {
        if w.label() == label {
            Some(w.to_owned())
        } else {
            None
        }
    });

    if window.is_none() {
        error!("Failed to find window by {window_context:?}");
    }

    window
}

fn workspace_id_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<String> {
    let url = window.url().unwrap();
    let re = Regex::new(r"/workspaces/(?<wid>\w+)").unwrap();
    match re.captures(url.as_str()) {
        None => None,
        Some(captures) => captures.name("wid").map(|c| c.as_str().to_string()),
    }
}

async fn workspace_from_window<R: Runtime>(window: &WebviewWindow<R>) -> YaakResult<Workspace> {
    match workspace_id_from_window(&window) {
        None => Err(GenericError("Failed to get workspace ID from window".to_string())),
        Some(id) => Ok(window.db().get_workspace(id.as_str())?),
    }
}

fn environment_id_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<String> {
    let url = window.url().unwrap();
    let mut query_pairs = url.query_pairs();
    query_pairs.find(|(k, _v)| k == "environment_id").map(|(_k, v)| v.to_string())
}

async fn environment_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<Environment> {
    match environment_id_from_window(&window) {
        None => None,
        Some(id) => window.db().get_environment(&id).ok(),
    }
}

fn cookie_jar_id_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<String> {
    let url = window.url().unwrap();
    let mut query_pairs = url.query_pairs();
    query_pairs.find(|(k, _v)| k == "cookie_jar_id").map(|(_k, v)| v.to_string())
}

async fn cookie_jar_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<CookieJar> {
    match cookie_jar_id_from_window(&window) {
        None => None,
        Some(id) => window.db().get_cookie_jar(&id).ok(),
    }
}
