use crate::error::Result;
use crate::manager::WebsocketManager;
use crate::render::render_websocket_request;
use crate::resolve::resolve_websocket_request;
use log::debug;
use log::{info, warn};
use std::str::FromStr;
use tauri::http::{HeaderMap, HeaderName};
use tauri::{AppHandle, Runtime, State, Url, WebviewWindow};
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use yaak_http::apply_path_placeholders;
use yaak_models::models::{
    HttpResponseHeader, WebsocketConnection, WebsocketConnectionState, WebsocketEvent,
    WebsocketEventType, WebsocketRequest,
};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    CallHttpAuthenticationRequest, HttpHeader, PluginWindowContext, RenderPurpose,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;

#[tauri::command]
pub(crate) async fn upsert_request<R: Runtime>(
    request: WebsocketRequest,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<WebsocketRequest> {
    Ok(app_handle.db().upsert_websocket_request(&request, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
pub(crate) async fn duplicate_request<R: Runtime>(
    request_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<WebsocketRequest> {
    let db = app_handle.db();
    let request = db.get_websocket_request(request_id)?;
    Ok(db.duplicate_websocket_request(&request, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
pub(crate) async fn delete_request<R: Runtime>(
    request_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<WebsocketRequest> {
    Ok(app_handle
        .db()
        .delete_websocket_request_by_id(request_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
pub(crate) async fn delete_connection<R: Runtime>(
    connection_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<WebsocketConnection> {
    Ok(app_handle
        .db()
        .delete_websocket_connection_by_id(connection_id, &UpdateSource::from_window(&window))?)
}

#[tauri::command]
pub(crate) async fn delete_connections<R: Runtime>(
    request_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<()> {
    Ok(app_handle.db().delete_all_websocket_connections_for_request(
        request_id,
        &UpdateSource::from_window(&window),
    )?)
}

#[tauri::command]
pub(crate) async fn list_events<R: Runtime>(
    connection_id: &str,
    app_handle: AppHandle<R>,
) -> Result<Vec<WebsocketEvent>> {
    Ok(app_handle.db().list_websocket_events(connection_id)?)
}

#[tauri::command]
pub(crate) async fn list_requests<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> Result<Vec<WebsocketRequest>> {
    Ok(app_handle.db().list_websocket_requests(workspace_id)?)
}

#[tauri::command]
pub(crate) async fn list_connections<R: Runtime>(
    workspace_id: &str,
    app_handle: AppHandle<R>,
) -> Result<Vec<WebsocketConnection>> {
    Ok(app_handle.db().list_websocket_connections(workspace_id)?)
}

#[tauri::command]
pub(crate) async fn send<R: Runtime>(
    connection_id: &str,
    environment_id: Option<&str>,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    ws_manager: State<'_, Mutex<WebsocketManager>>,
) -> Result<WebsocketConnection> {
    let (connection, unrendered_request) = {
        let db = app_handle.db();
        let connection = db.get_websocket_connection(connection_id)?;
        let unrendered_request = db.get_websocket_request(&connection.request_id)?;
        (connection, unrendered_request)
    };
    let environment = match environment_id {
        Some(id) => Some(app_handle.db().get_environment(id)?),
        None => None,
    };
    let base_environment =
        app_handle.db().get_base_environment(&unrendered_request.workspace_id)?;
    let (resolved_request, _auth_context_id) =
        resolve_websocket_request(&window, &unrendered_request)?;
    let request = render_websocket_request(
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

    let mut ws_manager = ws_manager.lock().await;
    ws_manager.send(&connection.id, Message::Text(request.message.clone().into())).await?;

    app_handle.db().upsert_websocket_event(
        &WebsocketEvent {
            connection_id: connection.id.clone(),
            request_id: request.id.clone(),
            workspace_id: connection.workspace_id.clone(),
            is_server: false,
            message_type: WebsocketEventType::Text,
            message: request.message.into(),
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )?;

    Ok(connection)
}

#[tauri::command]
pub(crate) async fn close<R: Runtime>(
    connection_id: &str,
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    ws_manager: State<'_, Mutex<WebsocketManager>>,
) -> Result<WebsocketConnection> {
    let connection = {
        let db = app_handle.db();
        let connection = db.get_websocket_connection(connection_id)?;
        db.upsert_websocket_connection(
            &WebsocketConnection {
                state: WebsocketConnectionState::Closing,
                ..connection
            },
            &UpdateSource::from_window(&window),
        )?
    };

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
    let unrendered_request = app_handle.db().get_websocket_request(request_id)?;
    let environment = match environment_id {
        Some(id) => Some(app_handle.db().get_environment(id)?),
        None => None,
    };
    let base_environment =
        app_handle.db().get_base_environment(&unrendered_request.workspace_id)?;
    let workspace = app_handle.db().get_workspace(&unrendered_request.workspace_id)?;
    let (resolved_request, auth_context_id) =
        resolve_websocket_request(&window, &unrendered_request)?;
    let request = render_websocket_request(
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

    let connection = app_handle.db().upsert_websocket_connection(
        &WebsocketConnection {
            workspace_id: request.workspace_id.clone(),
            request_id: request_id.to_string(),
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )?;

    let (mut url, url_parameters) = apply_path_placeholders(&request.url, request.url_parameters);
    if !url.starts_with("ws://") && !url.starts_with("wss://") {
        url.insert_str(0, "ws://");
    }

    // Add URL parameters to URL
    let mut url = match Url::parse(&url) {
        Ok(url) => url,
        Err(e) => {
            return Ok(app_handle.db().upsert_websocket_connection(
                &WebsocketConnection {
                    error: Some(format!("Failed to parse URL {}", e.to_string())),
                    state: WebsocketConnectionState::Closed,
                    ..connection
                },
                &UpdateSource::from_window(&window),
            )?);
        }
    };

    let mut headers = HeaderMap::new();

    for h in request.headers.clone() {
        if h.name.is_empty() && h.value.is_empty() {
            continue;
        }

        if !h.enabled {
            continue;
        }

        headers.insert(
            HeaderName::from_str(&h.name).unwrap(),
            HeaderValue::from_str(&h.value).unwrap(),
        );
    }

    match request.authentication_type {
        None => {
            // No authentication found. Not even inherited
        }
        Some(authentication_type) if authentication_type == "none" => {
            // Explicitly no authentication
        }
        Some(authentication_type) => {
            let auth = request.authentication.clone();
            let plugin_req = CallHttpAuthenticationRequest {
                context_id: format!("{:x}", md5::compute(auth_context_id)),
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
            let plugin_result = plugin_manager
                .call_http_authentication(&window, &authentication_type, plugin_req)
                .await?;
            for header in plugin_result.set_headers.unwrap_or_default() {
                match (HeaderName::from_str(&header.name), HeaderValue::from_str(&header.value)) {
                    (Ok(name), Ok(value)) => {
                        headers.insert(name, value);
                    }
                    _ => continue,
                };
            }
            let mut query_pairs = url.query_pairs_mut();
            for p in plugin_result.set_query_parameters.unwrap_or_default() {
                query_pairs.append_pair(&p.name, &p.value);
            }
        }
    }

    // Add cookies to WS HTTP Upgrade
    if let Some(id) = cookie_jar_id {
        let cookie_jar = app_handle.db().get_cookie_jar(id)?;

        let cookies = cookie_jar
            .cookies
            .iter()
            .filter_map(|cookie| {
                // HACK: same as in src-tauri/src/http_request.rs
                let json_cookie = serde_json::to_value(cookie).ok()?;
                match serde_json::from_value(json_cookie) {
                    Ok(cookie) => Some(Ok(cookie)),
                    Err(_e) => None,
                }
            })
            .collect::<Vec<Result<_>>>();

        let store = reqwest_cookie_store::CookieStore::from_cookies(cookies, true)?;

        // Convert WS URL -> HTTP URL bc reqwest_cookie_store's `get_request_values`
        // strictly matches based on Path/HttpOnly/Secure attributes even though WS upgrades are HTTP requests
        let http_url = convert_ws_url_to_http(&url);
        let pairs: Vec<_> = store.get_request_values(&http_url).collect();
        debug!("Inserting {} cookies into WS upgrade to {}", pairs.len(), url);

        let cookie_header_value = pairs
            .into_iter()
            .map(|(name, value)| format!("{}={}", name, value))
            .collect::<Vec<_>>()
            .join("; ");

        if !cookie_header_value.is_empty() {
            headers.insert(
                HeaderName::from_static("cookie"),
                HeaderValue::from_str(&cookie_header_value).unwrap(),
            );
        }
    }

    let (receive_tx, mut receive_rx) = mpsc::channel::<Message>(128);
    let mut ws_manager = ws_manager.lock().await;

    {
        let valid_query_pairs = url_parameters
            .into_iter()
            .filter(|p| p.enabled && !p.name.is_empty())
            .collect::<Vec<_>>();
        // NOTE: Only mutate query pairs if there are any, or it will append an empty `?` to the URL
        if !valid_query_pairs.is_empty() {
            let mut query_pairs = url.query_pairs_mut();
            for p in valid_query_pairs {
                query_pairs.append_pair(p.name.as_str(), p.value.as_str());
            }
        }
    }

    let response = match ws_manager
        .connect(
            &connection.id,
            url.as_str(),
            headers,
            receive_tx,
            workspace.setting_validate_certificates,
        )
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(app_handle.db().upsert_websocket_connection(
                &WebsocketConnection {
                    error: Some(e.to_string()),
                    state: WebsocketConnectionState::Closed,
                    ..connection
                },
                &UpdateSource::from_window(&window),
            )?);
        }
    };

    app_handle.db().upsert_websocket_event(
        &WebsocketEvent {
            connection_id: connection.id.clone(),
            request_id: request.id.clone(),
            workspace_id: connection.workspace_id.clone(),
            is_server: false,
            message_type: WebsocketEventType::Open,
            ..Default::default()
        },
        &UpdateSource::from_window(&window),
    )?;

    let response_headers = response
        .headers()
        .into_iter()
        .map(|(name, value)| HttpResponseHeader {
            name: name.to_string(),
            value: value.to_str().unwrap().to_string(),
        })
        .collect::<Vec<HttpResponseHeader>>();

    let connection = app_handle.db().upsert_websocket_connection(
        &WebsocketConnection {
            state: WebsocketConnectionState::Connected,
            headers: response_headers,
            status: response.status().as_u16() as i32,
            url: request.url.clone(),
            ..connection
        },
        &UpdateSource::from_window(&window),
    )?;

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

                app_handle
                    .db()
                    .upsert_websocket_event(
                        &WebsocketEvent {
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
                    .unwrap();
            }
            info!("Websocket connection closed");
            if !has_written_close {
                app_handle
                    .db()
                    .upsert_websocket_event(
                        &WebsocketEvent {
                            connection_id: connection_id.clone(),
                            request_id: request_id.clone(),
                            workspace_id: workspace_id.clone(),
                            is_server: true,
                            message_type: WebsocketEventType::Close,
                            ..Default::default()
                        },
                        &UpdateSource::from_window(&window),
                    )
                    .unwrap();
            }
            app_handle
                .db()
                .upsert_websocket_connection(
                    &WebsocketConnection {
                        workspace_id: request.workspace_id.clone(),
                        request_id: request_id.to_string(),
                        state: WebsocketConnectionState::Closed,
                        ..connection
                    },
                    &UpdateSource::from_window(&window),
                )
                .unwrap();
        });
    }

    Ok(connection)
}

/// Convert WS URL to HTTP URL for cookie filtering
/// WebSocket upgrade requests are HTTP requests initially, so HttpOnly cookies should apply
fn convert_ws_url_to_http(ws_url: &Url) -> Url {
    let mut http_url = ws_url.clone();

    match ws_url.scheme() {
        "ws" => {
            http_url.set_scheme("http").expect("Failed to set http scheme");
        }
        "wss" => {
            http_url.set_scheme("https").expect("Failed to set https scheme");
        }
        _ => {
            // Already HTTP/HTTPS, no conversion needed
        }
    }

    http_url
}
