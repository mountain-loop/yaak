use crate::error::Error::GenericError;
use crate::error::Result;
use crate::render::render_http_request;
use crate::response_err;
use log::{debug, error};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::fs::{File, create_dir_all};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio::sync::watch::Receiver;
use yaak_http::client::{
    HttpConnectionOptions, HttpConnectionProxySetting, HttpConnectionProxySettingAuth,
};
use yaak_http::manager::HttpConnectionManager;
use yaak_http::sender::ReqwestSender;
use yaak_http::tee_reader::TeeReader;
use yaak_http::transaction::HttpTransaction;
use yaak_http::types::{
    SendableBody, SendableHttpRequest, SendableHttpRequestOptions, append_query_params,
};
use yaak_models::blob_manager::{BlobManagerExt, BodyChunk};
use yaak_models::models::{
    CookieJar, Environment, HttpRequest, HttpResponse, HttpResponseEvent, HttpResponseHeader,
    HttpResponseState, ProxySetting, ProxySettingAuth,
};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    CallHttpAuthenticationRequest, HttpHeader, PluginContext, RenderPurpose,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::RenderOptions;
use yaak_tls::find_client_certificate;

/// Chunk size for storing request bodies (1MB)
const REQUEST_BODY_CHUNK_SIZE: usize = 1024 * 1024;

pub async fn send_http_request<R: Runtime>(
    window: &WebviewWindow<R>,
    unrendered_request: &HttpRequest,
    og_response: &HttpResponse,
    environment: Option<Environment>,
    cookie_jar: Option<CookieJar>,
    cancelled_rx: &mut Receiver<bool>,
) -> Result<HttpResponse> {
    send_http_request_with_context(
        window,
        unrendered_request,
        og_response,
        environment,
        cookie_jar,
        cancelled_rx,
        &PluginContext::new(window),
    )
    .await
}

pub async fn send_http_request_with_context<R: Runtime>(
    window: &WebviewWindow<R>,
    unrendered_request: &HttpRequest,
    og_response: &HttpResponse,
    environment: Option<Environment>,
    cookie_jar: Option<CookieJar>,
    cancelled_rx: &Receiver<bool>,
    plugin_context: &PluginContext,
) -> Result<HttpResponse> {
    let app_handle = window.app_handle().clone();
    let response = Arc::new(Mutex::new(og_response.clone()));
    let update_source = UpdateSource::from_window(window);

    // Execute the inner send logic and handle errors consistently
    let result = send_http_request_inner(
        window,
        unrendered_request,
        og_response,
        environment,
        cookie_jar,
        cancelled_rx,
        plugin_context,
    )
    .await;

    match result {
        Ok(response) => Ok(response),
        Err(e) => {
            Ok(response_err(&app_handle, &*response.lock().await, e.to_string(), &update_source))
        }
    }
}

async fn send_http_request_inner<R: Runtime>(
    window: &WebviewWindow<R>,
    unrendered_request: &HttpRequest,
    og_response: &HttpResponse,
    environment: Option<Environment>,
    cookie_jar: Option<CookieJar>,
    cancelled_rx: &Receiver<bool>,
    plugin_context: &PluginContext,
) -> Result<HttpResponse> {
    let app_handle = window.app_handle().clone();
    let plugin_manager = app_handle.state::<PluginManager>();
    let connection_manager = app_handle.state::<HttpConnectionManager>();
    let settings = window.db().get_settings();
    let workspace_id = &unrendered_request.workspace_id;
    let folder_id = unrendered_request.folder_id.as_deref();
    let environment_id = environment.map(|e| e.id);
    let http_response_id = og_response.id.clone();
    let workspace = window.db().get_workspace(workspace_id)?;
    let response = Arc::new(Mutex::new(og_response.clone()));
    let update_source = UpdateSource::from_window(window);
    let (resolved, auth_context_id) = resolve_http_request(window, unrendered_request)?;
    let cb = PluginTemplateCallback::new(window.app_handle(), &plugin_context, RenderPurpose::Send);
    let env_chain =
        window.db().resolve_environments(&workspace.id, folder_id, environment_id.as_deref())?;
    let request = render_http_request(&resolved, env_chain, &cb, &RenderOptions::throw()).await?;

    // Build the sendable request using the new SendableHttpRequest type
    let options = SendableHttpRequestOptions {
        follow_redirects: workspace.setting_follow_redirects,
        timeout: if workspace.setting_request_timeout > 0 {
            Some(Duration::from_millis(workspace.setting_request_timeout.unsigned_abs() as u64))
        } else {
            None
        },
    };
    let mut sendable_request = SendableHttpRequest::from_http_request(&request, options).await?;

    debug!("Sending request to {} {}", sendable_request.method, sendable_request.url);

    let proxy_setting = match settings.proxy {
        None => HttpConnectionProxySetting::System,
        Some(ProxySetting::Disabled) => HttpConnectionProxySetting::Disabled,
        Some(ProxySetting::Enabled { http, https, auth, bypass, disabled }) => {
            if disabled {
                HttpConnectionProxySetting::System
            } else {
                HttpConnectionProxySetting::Enabled {
                    http,
                    https,
                    bypass,
                    auth: match auth {
                        None => None,
                        Some(ProxySettingAuth { user, password }) => {
                            Some(HttpConnectionProxySettingAuth { user, password })
                        }
                    },
                }
            }
        }
    };

    let client_certificate =
        find_client_certificate(&sendable_request.url, &settings.client_certificates);

    // Add cookie store if specified
    let maybe_cookie_manager = match cookie_jar.clone() {
        Some(CookieJar { id, .. }) => {
            // NOTE: WE need to refetch the cookie jar because a chained request might have
            //  updated cookies when we rendered the request.
            let cj = window.db().get_cookie_jar(&id)?;
            // HACK: Can't construct Cookie without serde, so we have to do this
            let cookies = cj
                .cookies
                .iter()
                .filter_map(|cookie| {
                    let json_cookie = serde_json::to_value(cookie).ok()?;
                    serde_json::from_value(json_cookie).ok()?
                })
                .map(|c| Ok(c))
                .collect::<Vec<Result<_>>>();

            let cookie_store = CookieStore::from_cookies(cookies, true)?;
            let cookie_store = CookieStoreMutex::new(cookie_store);
            let cookie_store = Arc::new(cookie_store);
            let cookie_provider = Arc::clone(&cookie_store);
            Some((cookie_provider, cj))
        }
        None => None,
    };

    let client = connection_manager
        .get_client(&HttpConnectionOptions {
            id: plugin_context.id.clone(),
            validate_certificates: workspace.setting_validate_certificates,
            proxy: proxy_setting,
            cookie_provider: maybe_cookie_manager.as_ref().map(|(p, _)| Arc::clone(&p)),
            client_certificate,
        })
        .await?;

    // Apply authentication to the request
    apply_authentication(
        &window,
        &mut sendable_request,
        &request,
        auth_context_id,
        &plugin_manager,
        plugin_context,
    )
    .await?;

    let start_for_cancellation = Instant::now();
    let final_resp = execute_transaction(
        client,
        sendable_request,
        response.clone(),
        &http_response_id,
        &app_handle,
        &update_source,
        cancelled_rx.clone(),
    )
    .await;

    match final_resp {
        Ok(r) => Ok(r),
        Err(e) => {
            // Capture the error message so we can both record it and return the original error
            let err_msg = e.to_string();

            // Try to update the stored response to Closed with the error information.
            // Ignore any error from this update and always return the original error below.
            let _ = app_handle.with_tx(|tx| {
                if let Ok(mut r) = tx.get_http_response(&http_response_id) {
                    r.state = HttpResponseState::Closed;
                    r.elapsed = start_for_cancellation.elapsed().as_millis() as i32;
                    r.elapsed_headers = start_for_cancellation.elapsed().as_millis() as i32;
                    r.error = Some(err_msg.clone());
                    tx.update_http_response_if_id(&r, &UpdateSource::from_window(window))?;
                }
                Ok(())
            });

            Err(e)
        }
    }
}

pub fn resolve_http_request<R: Runtime>(
    window: &WebviewWindow<R>,
    request: &HttpRequest,
) -> Result<(HttpRequest, String)> {
    let mut new_request = request.clone();

    let (authentication_type, authentication, authentication_context_id) =
        window.db().resolve_auth_for_http_request(request)?;
    new_request.authentication_type = authentication_type;
    new_request.authentication = authentication;

    let headers = window.db().resolve_headers_for_http_request(request)?;
    new_request.headers = headers;

    Ok((new_request, authentication_context_id))
}

async fn execute_transaction<R: Runtime>(
    client: reqwest::Client,
    mut sendable_request: SendableHttpRequest,
    response: Arc<Mutex<HttpResponse>>,
    response_id: &str,
    app_handle: &AppHandle<R>,
    update_source: &UpdateSource,
    mut cancelled_rx: Receiver<bool>,
) -> Result<HttpResponse> {
    let workspace_id = { response.lock().await.workspace_id.clone() };
    let sender = ReqwestSender::with_client(client);
    let transaction = HttpTransaction::new(sender);
    let start = Instant::now();

    // Capture request headers before sending
    let request_headers: Vec<HttpResponseHeader> = sendable_request
        .headers
        .iter()
        .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
        .collect();

    // Update response with headers info and mark as connected
    app_handle.with_tx(|tx| {
        let mut r = tx.get_http_response(&response_id)?;
        r.url = sendable_request.url.clone();
        r.request_headers = request_headers.clone();
        tx.update_http_response_if_id(&r, &update_source)?;
        Ok(())
    })?;

    // Create channel for receiving events and spawn a task to store them in DB
    let (event_tx, mut event_rx) =
        tokio::sync::mpsc::unbounded_channel::<yaak_http::sender::HttpResponseEvent>();

    // Write events to DB in a task
    {
        let response_id = response_id.to_string();
        let app_handle = app_handle.clone();
        let update_source = update_source.clone();
        let workspace_id = workspace_id.clone();
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                let db_event = HttpResponseEvent::new(&response_id, &workspace_id, event.into());
                let _ = app_handle.db().upsert_http_response_event(&db_event, &update_source);
            }
        });
    };

    // Capture request body as it's sent
    let body_id = format!("{}.request", response_id);
    sendable_request.body = match sendable_request.body {
        Some(SendableBody::Bytes(bytes)) => {
            write_bytes_to_db_sync(&app_handle, &response_id, &body_id, bytes.to_vec())?;
            Some(SendableBody::Bytes(bytes))
        }
        Some(SendableBody::Stream(stream)) => {
            // Wrap stream with TeeReader to capture data as it's read
            let (body_chunk_tx, body_chunk_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let tee_reader = TeeReader::new(stream, body_chunk_tx);
            let pinned: Pin<Box<dyn AsyncRead + Send + 'static>> = Box::pin(tee_reader);

            // Spawn task to write request body chunks to blob DB
            let app_handle = app_handle.clone();
            let response_id = response_id.to_string();
            let workspace_id = workspace_id.clone();
            let body_id = body_id.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = write_stream_chunks_to_db(
                    app_handle,
                    &body_id,
                    &workspace_id,
                    &response_id,
                    body_chunk_rx,
                )
                .await
                {
                    error!("Error writing stream chunks to DB: {}", e);
                };
            });

            // For streams, size is determined after streaming completes
            Some(SendableBody::Stream(pinned))
        }
        None => None,
    };

    // Execute the transaction with cancellation support
    // This returns the response with headers, but body is not yet consumed
    // Events (headers, settings, chunks) are sent through the channel
    let mut http_response = transaction
        .execute_with_cancellation(sendable_request, cancelled_rx.clone(), event_tx)
        .await?;

    // Prepare the response path before consuming the body
    let dir = app_handle.path().app_data_dir()?;
    let base_dir = dir.join("responses");
    create_dir_all(&base_dir).await?;

    let body_path = if response_id.is_empty() {
        base_dir.join(uuid::Uuid::new_v4().to_string())
    } else {
        base_dir.join(&response_id)
    };

    // Extract metadata before consuming the body (headers are available immediately)
    // Url might change, so update again
    let headers: Vec<HttpResponseHeader> = http_response
        .headers
        .iter()
        .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
        .collect();

    app_handle.with_tx(|tx| {
        // Update response with headers info and mark as connected
        let mut r = tx.get_http_response(&response_id)?;
        r.body_path = Some(body_path.to_string_lossy().to_string());
        r.elapsed_headers = start.elapsed().as_millis() as i32;
        r.status = http_response.status as i32;
        r.status_reason = http_response.status_reason.clone().clone();
        r.url = http_response.url.clone().clone();
        r.remote_addr = http_response.remote_addr.clone();
        r.version = http_response.version.clone().clone();
        r.headers = headers.clone();
        r.content_length = http_response.content_length.map(|l| l as i32);
        r.request_headers = http_response
            .request_headers
            .iter()
            .map(|(n, v)| HttpResponseHeader { name: n.clone(), value: v.clone() })
            .collect();
        r.state = HttpResponseState::Connected;
        tx.update_http_response_if_id(&r, &update_source)?;
        Ok(())
    })?;

    // Get the body stream for manual consumption
    let mut body_stream = http_response.into_body_stream()?;

    // Open file for writing
    let mut file = File::options()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&body_path)
        .await
        .map_err(|e| GenericError(format!("Failed to open file: {}", e)))?;

    // Stream body to file, updating DB on each chunk
    let mut written_bytes: usize = 0;
    let mut buf = [0u8; 8192];

    loop {
        // Check for cancellation. If we already have headers/body, just close cleanly without error
        if *cancelled_rx.borrow() {
            break;
        }

        // Use select! to race between reading and cancellation, so cancellation is immediate
        let read_result = tokio::select! {
            biased;
            _ = cancelled_rx.changed() => {
                break;
            }
            result = body_stream.read(&mut buf) => result,
        };

        match read_result {
            Ok(0) => break, // EOF
            Ok(n) => {
                file.write_all(&buf[..n])
                    .await
                    .map_err(|e| GenericError(format!("Failed to write to file: {}", e)))?;
                file.flush()
                    .await
                    .map_err(|e| GenericError(format!("Failed to flush file: {}", e)))?;
                written_bytes += n;

                // Update response in DB with progress
                app_handle.with_tx(|tx| {
                    let mut resp = tx.get_http_response(&response_id)?;
                    resp.elapsed = start.elapsed().as_millis() as i32;
                    resp.content_length = Some(written_bytes as i32);
                    tx.update_http_response_if_id(&resp, &update_source)?;
                    Ok(resp)
                })?;
            }
            Err(e) => {
                return Err(GenericError(format!("Failed to read response body: {}", e)));
            }
        }
    }

    // Final update with closed state
    let resp = app_handle.with_tx(|tx| {
        let mut resp = tx.get_http_response(&response_id)?;
        resp.elapsed = start.elapsed().as_millis() as i32;
        resp.state = HttpResponseState::Closed;
        tx.update_http_response_if_id(&resp, &update_source)?;
        Ok(resp)
    })?;

    Ok(resp)
}

fn write_bytes_to_db_sync<R: Runtime>(
    app_handle: &AppHandle<R>,
    response_id: &str,
    body_id: &str,
    data: Vec<u8>,
) -> Result<()> {
    if data.is_empty() {
        return Ok(());
    }

    // Write in chunks if data is large
    let mut offset = 0;
    let mut chunk_index = 0;
    while offset < data.len() {
        let end = std::cmp::min(offset + REQUEST_BODY_CHUNK_SIZE, data.len());
        let chunk_data = data[offset..end].to_vec();
        let chunk = BodyChunk::new(body_id, chunk_index, chunk_data);
        app_handle.blobs().insert_chunk(&chunk)?;
        offset = end;
        chunk_index += 1;
    }

    // Update the response with the total request body size
    app_handle.with_tx(|tx| {
        if let Ok(mut response) = tx.get_http_response(&response_id) {
            response.request_content_length = Some(data.len() as i32);
            tx.update_http_response_if_id(&response, &UpdateSource::Background)?;
        }
        Ok(())
    })?;

    Ok(())
}

async fn write_stream_chunks_to_db<R: Runtime>(
    app_handle: AppHandle<R>,
    body_id: &str,
    workspace_id: &str,
    response_id: &str,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) -> Result<()> {
    let mut buffer = Vec::with_capacity(REQUEST_BODY_CHUNK_SIZE);
    let mut chunk_index = 0;
    let mut total_bytes: usize = 0;

    while let Some(data) = rx.recv().await {
        total_bytes += data.len();
        buffer.extend_from_slice(&data);

        // Flush when buffer reaches chunk size
        while buffer.len() >= REQUEST_BODY_CHUNK_SIZE {
            debug!("Writing chunk {chunk_index} to DB");
            let chunk_data: Vec<u8> = buffer.drain(..REQUEST_BODY_CHUNK_SIZE).collect();
            let chunk = BodyChunk::new(body_id, chunk_index, chunk_data);
            app_handle.blobs().insert_chunk(&chunk)?;
            app_handle.db().upsert_http_response_event(
                &HttpResponseEvent::new(
                    response_id,
                    workspace_id,
                    yaak_http::sender::HttpResponseEvent::ChunkSent { bytes: data.len() }.into(),
                ),
                &UpdateSource::Background,
            )?;
            chunk_index += 1;
        }
    }

    // Flush remaining data
    if !buffer.is_empty() {
        let chunk = BodyChunk::new(body_id, chunk_index, buffer);
        debug!("Flushing remaining data {chunk_index} {}", chunk.data.len());
        app_handle.blobs().insert_chunk(&chunk)?;
        app_handle.db().upsert_http_response_event(
            &HttpResponseEvent::new(
                response_id,
                workspace_id,
                yaak_http::sender::HttpResponseEvent::ChunkSent { bytes: chunk.data.len() }.into(),
            ),
            &UpdateSource::Background,
        )?;
    }

    // Update the response with the total request body size
    app_handle.with_tx(|tx| {
        debug!("Updating final body length {total_bytes}");
        if let Ok(mut response) = tx.get_http_response(&response_id) {
            response.request_content_length = Some(total_bytes as i32);
            tx.update_http_response_if_id(&response, &UpdateSource::Background)?;
        }
        Ok(())
    })?;

    Ok(())
}

async fn apply_authentication<R: Runtime>(
    window: &WebviewWindow<R>,
    sendable_request: &mut SendableHttpRequest,
    request: &HttpRequest,
    auth_context_id: String,
    plugin_manager: &PluginManager,
    plugin_context: &PluginContext,
) -> Result<()> {
    match &request.authentication_type {
        None => {
            // No authentication found. Not even inherited
        }
        Some(authentication_type) if authentication_type == "none" => {
            // Explicitly no authentication
        }
        Some(authentication_type) => {
            let req = CallHttpAuthenticationRequest {
                context_id: format!("{:x}", md5::compute(auth_context_id)),
                values: serde_json::from_value(serde_json::to_value(&request.authentication)?)?,
                url: sendable_request.url.clone(),
                method: sendable_request.method.clone(),
                headers: sendable_request
                    .headers
                    .iter()
                    .map(|(name, value)| HttpHeader {
                        name: name.to_string(),
                        value: value.to_string(),
                    })
                    .collect(),
            };
            let plugin_result = plugin_manager
                .call_http_authentication(&window, &authentication_type, req, plugin_context)
                .await?;

            for header in plugin_result.set_headers.unwrap_or_default() {
                sendable_request.insert_header((header.name, header.value));
            }

            if let Some(params) = plugin_result.set_query_parameters {
                let params = params.into_iter().map(|p| (p.name, p.value)).collect::<Vec<_>>();
                sendable_request.url = append_query_params(&sendable_request.url, params);
            }
        }
    }
    Ok(())
}
