use crate::error::Error::GenericError;
use crate::error::Result;
use crate::manager::WebsocketManager;
use crate::render::render_request;
use log::{info, warn};
use std::str::FromStr;
use tauri::http::{HeaderMap, HeaderName};
use tauri::{AppHandle, Runtime, State, Url, WebviewWindow};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use yaak_http::apply_path_placeholders;
use yaak_models::models::{
    HttpResponseHeader, WebsocketConnection, WebsocketConnectionState, WebsocketEvent,
    WebsocketEventType, WebsocketRequest,
};
use yaak_models::queries;
use yaak_models::queries::{
    get_base_environment, get_cookie_jar, get_environment, get_websocket_connection,
    get_websocket_request, upsert_websocket_connection, upsert_websocket_event, UpdateSource,
};
use yaak_plugins::events::{
    CallHttpAuthenticationRequest, HttpHeader, RenderPurpose, WindowContext,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;

#[tauri::command]
pub(crate) async fn upsert_request<R: Runtime>(
    request: WebsocketRequest,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<WebsocketRequest> {
    Ok(queries::upsert_websocket_request(&app_handle, request, &UpdateSource::from_window(&window))
        .await?)
}

#[tauri::command]
pub(crate) async fn duplicate_request<R: Runtime>(
    request_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<WebsocketRequest> {
    Ok(queries::duplicate_websocket_request(
        &app_handle,
        request_id,
        &UpdateSource::from_window(&window),
    )
    .await?)
}

#[tauri::command]
pub(crate) async fn delete_request<R: Runtime>(
    request_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<WebsocketRequest> {
    Ok(queries::delete_websocket_request(&app_handle, request_id, &UpdateSource::from_window(&window)).await?)
}

#[tauri::command]
pub(crate) async fn delete_connection<R: Runtime>(
    connection_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<WebsocketConnection> {
    Ok(queries::delete_websocket_connection(&app_handle, connection_id, &UpdateSource::from_window(&window))
        .await?)
}

#[tauri::command]
pub(crate) async fn delete_connections<R: Runtime>(
    request_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<()> {
    Ok(queries::delete_all_websocket_connections(&app_handle, request_id, &UpdateSource::from_window(&window))
        .await?)
}

#[tauri::command]
pub(crate) async fn list_events<R: Runtime>(
    connection_id: &str,
    app_handle: AppHandle<R>,
) -> Result<Vec<WebsocketEvent>> {
    Ok(queries::list_websocket_events(&app_handle, connection_id).await?)
}

#[tauri::command]
pub(crate) async fn list_requests<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> Result<Vec<WebsocketRequest>> {
    Ok(queries::list_websocket_requests(&app_handle, workspace_id).await?)
}

#[tauri::command]
pub(crate) async fn list_connections<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> Result<Vec<WebsocketConnection>> {
    Ok(queries::list_websocket_connections_for_workspace(&app_handle, workspace_id).await?)
}

#[tauri::command]
pub(crate) async fn send<R: Runtime>(
    connection_id: &str,
    environment_id: Option<&str>,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    ws_manager: State<'_, Mutex<WebsocketManager>>,
) -> Result<WebsocketConnection> {
    let connection = get_websocket_connection(&app_handle, connection_id).await?;
    let unrendered_request = get_websocket_request(&app_handle, &connection.request_id)
        .await?
        .ok_or(GenericError("WebSocket Request not found".to_string()))?;
    let environment = match environment_id {
        Some(id) => Some(get_environment(&app_handle, id).await?),
        None => None,
    };
    let base_environment =
        get_base_environment(&app_handle, &unrendered_request.workspace_id).await?;
    let request = render_request(
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

    let mut ws_manager = ws_manager.lock().await;
    ws_manager.send(&connection.id, Message::Text(request.message.clone().into())).await?;

    upsert_websocket_event(
        &app_handle,
        WebsocketEvent {
            connection_id: connection.id.clone(),
            request_id: request.id.clone(),
            workspace_id: connection.workspace_id.clone(),
            is_server: false,
            message_type: WebsocketEventType::Text,
            message: request.message.into(),
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )
    .await
    .unwrap();

    Ok(connection)
}

#[tauri::command]
pub(crate) async fn close<R: Runtime>(
    connection_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    ws_manager: State<'_, Mutex<WebsocketManager>>,
) -> Result<WebsocketConnection> {
    let connection = get_websocket_connection(&app_handle, connection_id).await?;
    let connection = upsert_websocket_connection(
        &app_handle,
        &WebsocketConnection {
            state: WebsocketConnectionState::Closing,
            ..connection
        },
        &UpdateSource::from_window(&window),
    )
    .await
    .unwrap();

    let mut ws_manager = ws_manager.lock().await;
    if let Err(e) = ws_manager.close(&connection.id).await {
        warn!("Failed to close WebSocket connection: {e:?}");
    };

    Ok(connection)
}

#[tauri::command]
pub(crate) async fn connect<R: Runtime>(
    request_id: &str,
    environment_id: Option<&str>,
    cookie_jar_id: Option<&str>,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
    ws_manager: State<'_, Mutex<WebsocketManager>>,
) -> Result<WebsocketConnection> {
    let unrendered_request = get_websocket_request(&app_handle, request_id)
        .await?
        .ok_or(GenericError("Failed to find GRPC request".to_string()))?;
    let environment = match environment_id {
        Some(id) => Some(get_environment(&app_handle, id).await?),
        None => None,
    };
    let base_environment =
        get_base_environment(&app_handle, &unrendered_request.workspace_id).await?;
    let request = render_request(
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

    let mut headers = HeaderMap::new();
    if let Some(auth_name) = request.authentication_type.clone() {
        let auth = request.authentication.clone();
        let plugin_req = CallHttpAuthenticationRequest {
            context_id: format!("{:x}", md5::compute(request_id.to_string())),
            values: serde_json::from_value(serde_json::to_value(&auth).unwrap()).unwrap(),
            method: "POST".to_string(),
            url: request.url.clone(),
            headers: request
                .headers
                .clone()
                .into_iter()
                .map(|h| HttpHeader {
                    name: h.name,
                    value: h.value,
                })
                .collect(),
        };
        let plugin_result =
            plugin_manager.call_http_authentication(&window, &auth_name, plugin_req).await?;
        for header in plugin_result.set_headers {
            headers.insert(
                HeaderName::from_str(&header.name).unwrap(),
                HeaderValue::from_str(&header.value).unwrap(),
            );
        }
    }

    // TODO: Handle cookies
    let _cookie_jar = match cookie_jar_id {
        Some(id) => Some(get_cookie_jar(&app_handle, id).await?),
        None => None,
    };

    let connection = upsert_websocket_connection(
        &app_handle,
        &WebsocketConnection {
            workspace_id: request.workspace_id.clone(),
            request_id: request_id.to_string(),
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )
    .await?;

    let (receive_tx, mut receive_rx) = mpsc::channel::<Message>(128);
    let mut ws_manager = ws_manager.lock().await;

    let (url, url_parameters) = apply_path_placeholders(&request.url, request.url_parameters);

    // Add URL parameters to URL
    let mut url = Url::parse(&url).unwrap();
    {
        let mut query_pairs = url.query_pairs_mut();
        for p in url_parameters.clone() {
            if !p.enabled || p.name.is_empty() {
                continue;
            }
            query_pairs.append_pair(p.name.as_str(), p.value.as_str());
        }
    }

    let response = match ws_manager.connect(&connection.id, url.as_str(), headers, receive_tx).await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(upsert_websocket_connection(
                &app_handle,
                &WebsocketConnection {
                    error: Some(format!("{e:?}")),
                    state: WebsocketConnectionState::Closed,
                    ..connection
                },
                &UpdateSource::from_window(&window),
            )
            .await?);
        }
    };

    upsert_websocket_event(
        &app_handle,
        WebsocketEvent {
            connection_id: connection.id.clone(),
            request_id: request.id.clone(),
            workspace_id: connection.workspace_id.clone(),
            is_server: false,
            message_type: WebsocketEventType::Open,
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )
    .await
    .unwrap();

    let response_headers = response
        .headers()
        .into_iter()
        .map(|(name, value)| HttpResponseHeader {
            name: name.to_string(),
            value: value.to_str().unwrap().to_string(),
        })
        .collect::<Vec<HttpResponseHeader>>();

    let connection = upsert_websocket_connection(
        &app_handle,
        &WebsocketConnection {
            state: WebsocketConnectionState::Connected,
            headers: response_headers,
            status: response.status().as_u16() as i32,
            url: request.url.clone(),
            ..connection
        },
        &UpdateSource::from_window(&window),
    )
    .await?;

    {
        let connection_id = connection.id.clone();
        let request_id = request.id.to_string();
        let workspace_id = request.workspace_id.clone();
        let connection = connection.clone();
        let mut has_written_close = false;
        tokio::spawn(async move {
            while let Some(message) = receive_rx.recv().await {
                if let Message::Close(_) = message {
                    has_written_close = true;
                }

                upsert_websocket_event(
                    &app_handle,
                    WebsocketEvent {
                        connection_id: connection_id.clone(),
                        request_id: request_id.clone(),
                        workspace_id: workspace_id.clone(),
                        is_server: true,
                        message_type: match message {
                            Message::Text(_) => WebsocketEventType::Text,
                            Message::Binary(_) => WebsocketEventType::Binary,
                            Message::Ping(_) => WebsocketEventType::Ping,
                            Message::Pong(_) => WebsocketEventType::Pong,
                            Message::Close(_) => WebsocketEventType::Close,
                            // Raw frame will never happen during a read
                            Message::Frame(_) => WebsocketEventType::Frame,
                        },
                        message: message.into_data().into(),
                        ..Default::default()
                    },
                    &UpdateSource::from_window(&window),
                )
                .await
                .unwrap();
            }
            info!("Websocket connection closed");
            if !has_written_close {
                upsert_websocket_event(
                    &app_handle,
                    WebsocketEvent {
                        connection_id: connection_id.clone(),
                        request_id: request_id.clone(),
                        workspace_id: workspace_id.clone(),
                        is_server: true,
                        message_type: WebsocketEventType::Close,
                        ..Default::default()
                    },
                    &UpdateSource::from_window(&window),
                )
                .await
                .unwrap();
            }
            upsert_websocket_connection(
                &app_handle,
                &WebsocketConnection {
                    workspace_id: request.workspace_id.clone(),
                    request_id: request_id.to_string(),
                    state: WebsocketConnectionState::Closed,
                    ..connection
                },
                &UpdateSource::from_window(&window),
            )
            .await
            .unwrap();
        });
    }

    Ok(connection)
}
