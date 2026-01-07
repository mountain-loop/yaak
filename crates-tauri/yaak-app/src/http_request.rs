use crate::error::Error::GenericError;
use crate::error::Result;
use crate::render::render_http_request;
use log::{debug, warn};
use std::pin::Pin;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::fs::{File, create_dir_all};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::watch::Receiver;
use tokio_util::bytes::Bytes;
use yaak_http::client::{
    HttpConnectionOptions, HttpConnectionProxySetting, HttpConnectionProxySettingAuth,
};
use yaak_http::cookies::CookieStore;
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

/// Context for managing response state during HTTP transactions.
/// Handles both persisted responses (stored in DB) and ephemeral responses (in-memory only).
struct ResponseContext<R: Runtime> {
    app_handle: AppHandle<R>,
    response: HttpResponse,
    update_source: UpdateSource,
}

impl<R: Runtime> ResponseContext<R> {
    fn new(app_handle: AppHandle<R>, response: HttpResponse, update_source: UpdateSource) -> Self {
        Self { app_handle, response, update_source }
    }

    /// Whether this response is persisted (has a non-empty ID)
    fn is_persisted(&self) -> bool {
        !self.response.id.is_empty()
    }

    /// Update the response state. For persisted responses, fetches from DB, applies the
    /// closure, and updates the DB. For ephemeral responses, just applies the closure
    /// to the in-memory response.
    fn update<F>(&mut self, func: F) -> Result<()>
    where
        F: FnOnce(&mut HttpResponse),
    {
        if self.is_persisted() {
            let r = self.app_handle.with_tx(|tx| {
                let mut r = tx.get_http_response(&self.response.id)?;
                func(&mut r);
                tx.update_http_response_if_id(&r, &self.update_source)?;
                Ok(r)
            })?;
            self.response = r;
            Ok(())
        } else {
            func(&mut self.response);
            Ok(())
        }
    }

    /// Get the current response state
    fn response(&self) -> &HttpResponse {
        &self.response
    }
}

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
    let update_source = UpdateSource::from_window(window);
    let mut response_ctx =
        ResponseContext::new(app_handle.clone(), og_response.clone(), update_source);

    // Execute the inner send logic and handle errors consistently
    let start = Instant::now();
    let result = send_http_request_inner(
        window,
        unrendered_request,
        environment,
        cookie_jar,
        cancelled_rx,
        plugin_context,
        &mut response_ctx,
    )
    .await;

    match result {
        Ok(response) => Ok(response),
        Err(e) => {
            let error = e.to_string();
            let elapsed = start.elapsed().as_millis() as i32;
            warn!("Failed to send request: {error:?}");
            let _ = response_ctx.update(|r| {
                r.state = HttpResponseState::Closed;
                r.elapsed = elapsed;
                if r.elapsed_headers == 0 {
                    r.elapsed_headers = elapsed;
                }
                r.error = Some(error);
            });
            Ok(response_ctx.response().clone())
        }
    }
}

async fn send_http_request_inner<R: Runtime>(
    window: &WebviewWindow<R>,
    unrendered_request: &HttpRequest,
    environment: Option<Environment>,
    cookie_jar: Option<CookieJar>,
    cancelled_rx: &Receiver<bool>,
    plugin_context: &PluginContext,
    response_ctx: &mut ResponseContext<R>,
) -> Result<HttpResponse> {
    let app_handle = window.app_handle().clone();
    let plugin_manager = app_handle.state::<PluginManager>();
    let connection_manager = app_handle.state::<HttpConnectionManager>();
    let settings = window.db().get_settings();
    let workspace_id = &unrendered_request.workspace_id;
    let folder_id = unrendered_request.folder_id.as_deref();
    let environment_id = environment.map(|e| e.id);
    let workspace = window.db().get_workspace(workspace_id)?;
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

    // Create cookie store if a cookie jar is specified
    let maybe_cookie_store = match cookie_jar.clone() {
        Some(CookieJar { id, .. }) => {
            // NOTE: We need to refetch the cookie jar because a chained request might have
            //  updated cookies when we rendered the request.
            let cj = window.db().get_cookie_jar(&id)?;
            let cookie_store = CookieStore::from_cookies(cj.cookies.clone());
            Some((cookie_store, cj))
        }
        None => None,
    };

    let client = connection_manager
        .get_client(&HttpConnectionOptions {
            id: plugin_context.id.clone(),
            validate_certificates: workspace.setting_validate_certificates,
            proxy: proxy_setting,
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

    let cookie_store = maybe_cookie_store.as_ref().map(|(cs, _)| cs.clone());
    let result = execute_transaction(
        client,
        sendable_request,
        response_ctx,
        cancelled_rx.clone(),
        cookie_store,
    )
    .await;

    // Wait for blob writing to complete and check for errors
    let final_result = match result {
        Ok((response, maybe_blob_write_handle)) => {
            // Check if blob writing failed
            if let Some(handle) = maybe_blob_write_handle {
                if let Ok(Err(e)) = handle.await {
                    // Update response with the storage error
                    let _ = response_ctx.update(|r| {
                        let error_msg =
                            format!("Request succeeded but failed to store request body: {}", e);
                        r.error = Some(match &r.error {
                            Some(existing) => format!("{}; {}", existing, error_msg),
                            None => error_msg,
                        });
                    });
                }
            }
            Ok(response)
        }
        Err(e) => Err(e),
    };

    // Persist cookies back to the database after the request completes
    if let Some((cookie_store, mut cj)) = maybe_cookie_store {
        let cookies = cookie_store.get_all_cookies();
        cj.cookies = cookies;
        if let Err(e) = window.db().upsert_cookie_jar(&cj, &UpdateSource::Background) {
            warn!("Failed to persist cookies to database: {}", e);
        }
    }

    final_result
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
    response_ctx: &mut ResponseContext<R>,
    mut cancelled_rx: Receiver<bool>,
    cookie_store: Option<CookieStore>,
) -> Result<(HttpResponse, Option<tauri::async_runtime::JoinHandle<Result<()>>>)> {
    let app_handle = &response_ctx.app_handle.clone();
    let response_id = response_ctx.response().id.clone();
    let workspace_id = response_ctx.response().workspace_id.clone();
    let is_persisted = response_ctx.is_persisted();

    let sender = ReqwestSender::with_client(client);
    let transaction = match cookie_store {
        Some(cs) => HttpTransaction::with_cookie_store(sender, cs),
        None => HttpTransaction::new(sender),
    };
    let start = Instant::now();

    // Capture request headers before sending
    let request_headers: Vec<HttpResponseHeader> = sendable_request
        .headers
        .iter()
        .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
        .collect();

    // Update response with headers info
    response_ctx.update(|r| {
        r.url = sendable_request.url.clone();
        r.request_headers = request_headers;
    })?;

    // Create bounded channel for receiving events and spawn a task to store them in DB
    // Buffer size of 100 events provides back pressure if DB writes are slow
    let (event_tx, mut event_rx) =
        tokio::sync::mpsc::channel::<yaak_http::sender::HttpResponseEvent>(100);

    // Write events to DB in a task (only for persisted responses)
    if is_persisted {
        let response_id = response_id.clone();
        let app_handle = app_handle.clone();
        let update_source = response_ctx.update_source.clone();
        let workspace_id = workspace_id.clone();
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                let db_event = HttpResponseEvent::new(&response_id, &workspace_id, event.into());
                let _ = app_handle.db().upsert_http_response_event(&db_event, &update_source);
            }
        });
    } else {
        // For ephemeral responses, just drain the events
        tokio::spawn(async move { while event_rx.recv().await.is_some() {} });
    };

    // Capture request body as it's sent (only for persisted responses)
    let body_id = format!("{}.request", response_id);
    let maybe_blob_write_handle = match sendable_request.body {
        Some(SendableBody::Bytes(bytes)) => {
            if is_persisted {
                write_bytes_to_db_sync(response_ctx, &body_id, bytes.clone())?;
            }
            sendable_request.body = Some(SendableBody::Bytes(bytes));
            None
        }
        Some(SendableBody::Stream(stream)) => {
            // Wrap stream with TeeReader to capture data as it's read
            // Use unbounded channel to ensure all data is captured without blocking the HTTP request
            let (body_chunk_tx, body_chunk_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let tee_reader = TeeReader::new(stream, body_chunk_tx);
            let pinned: Pin<Box<dyn AsyncRead + Send + 'static>> = Box::pin(tee_reader);

            let handle = if is_persisted {
                // Spawn task to write request body chunks to blob DB
                let app_handle = app_handle.clone();
                let response_id = response_id.clone();
                let workspace_id = workspace_id.clone();
                let body_id = body_id.clone();
                let update_source = response_ctx.update_source.clone();
                Some(tauri::async_runtime::spawn(async move {
                    write_stream_chunks_to_db(
                        app_handle,
                        &body_id,
                        &workspace_id,
                        &response_id,
                        &update_source,
                        body_chunk_rx,
                    )
                    .await
                }))
            } else {
                // For ephemeral responses, just drain the body chunks
                tauri::async_runtime::spawn(async move {
                    let mut rx = body_chunk_rx;
                    while rx.recv().await.is_some() {}
                });
                None
            };

            sendable_request.body = Some(SendableBody::Stream(pinned));
            handle
        }
        None => {
            sendable_request.body = None;
            None
        }
    };

    // Execute the transaction with cancellation support
    // This returns the response with headers, but body is not yet consumed
    // Events (headers, settings, chunks) are sent through the channel
    let mut http_response = transaction
        .execute_with_cancellation(sendable_request, cancelled_rx.clone(), event_tx)
        .await?;

    // Prepare the response path before consuming the body
    let body_path = if response_id.is_empty() {
        // Ephemeral responses: use OS temp directory for automatic cleanup
        let temp_dir = std::env::temp_dir().join("yaak-ephemeral-responses");
        create_dir_all(&temp_dir).await?;
        temp_dir.join(uuid::Uuid::new_v4().to_string())
    } else {
        // Persisted responses: use app data directory
        let dir = app_handle.path().app_data_dir()?;
        let base_dir = dir.join("responses");
        create_dir_all(&base_dir).await?;
        base_dir.join(&response_id)
    };

    // Extract metadata before consuming the body (headers are available immediately)
    // Url might change, so update again
    response_ctx.update(|r| {
        r.body_path = Some(body_path.to_string_lossy().to_string());
        r.elapsed_headers = start.elapsed().as_millis() as i32;
        r.status = http_response.status as i32;
        r.status_reason = http_response.status_reason.clone();
        r.url = http_response.url.clone();
        r.remote_addr = http_response.remote_addr.clone();
        r.version = http_response.version.clone();
        r.headers = http_response
            .headers
            .iter()
            .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
            .collect();
        r.content_length = http_response.content_length.map(|l| l as i32);
        r.state = HttpResponseState::Connected;
        r.request_headers = http_response
            .request_headers
            .iter()
            .map(|(n, v)| HttpResponseHeader { name: n.clone(), value: v.clone() })
            .collect();
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

    // Stream body to file, with throttled DB updates to avoid excessive writes
    let mut written_bytes: usize = 0;
    let mut last_update_time = start;
    let mut buf = [0u8; 8192];

    // Throttle settings: update DB at most every 100ms
    const UPDATE_INTERVAL_MS: u128 = 100;

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

                // Throttle DB updates: only update if enough time has passed
                let now = Instant::now();
                let elapsed_since_update = now.duration_since(last_update_time).as_millis();

                if elapsed_since_update >= UPDATE_INTERVAL_MS {
                    response_ctx.update(|r| {
                        r.elapsed = start.elapsed().as_millis() as i32;
                        r.content_length = Some(written_bytes as i32);
                    })?;
                    last_update_time = now;
                }
            }
            Err(e) => {
                return Err(GenericError(format!("Failed to read response body: {}", e)));
            }
        }
    }

    // Final update with closed state and accurate byte count
    response_ctx.update(|r| {
        r.elapsed = start.elapsed().as_millis() as i32;
        r.content_length = Some(written_bytes as i32);
        r.state = HttpResponseState::Closed;
    })?;

    Ok((response_ctx.response().clone(), maybe_blob_write_handle))
}

fn write_bytes_to_db_sync<R: Runtime>(
    response_ctx: &mut ResponseContext<R>,
    body_id: &str,
    data: Bytes,
) -> Result<()> {
    if data.is_empty() {
        return Ok(());
    }

    // Write in chunks if data is large
    let mut offset = 0;
    let mut chunk_index = 0;
    while offset < data.len() {
        let end = std::cmp::min(offset + REQUEST_BODY_CHUNK_SIZE, data.len());
        let chunk_data = data.slice(offset..end).to_vec();
        let chunk = BodyChunk::new(body_id, chunk_index, chunk_data);
        response_ctx.app_handle.blobs().insert_chunk(&chunk)?;
        offset = end;
        chunk_index += 1;
    }

    // Update the response with the total request body size
    response_ctx.update(|r| {
        r.request_content_length = Some(data.len() as i32);
    })?;

    Ok(())
}

async fn write_stream_chunks_to_db<R: Runtime>(
    app_handle: AppHandle<R>,
    body_id: &str,
    workspace_id: &str,
    response_id: &str,
    update_source: &UpdateSource,
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
                    yaak_http::sender::HttpResponseEvent::ChunkSent {
                        bytes: REQUEST_BODY_CHUNK_SIZE,
                    }
                    .into(),
                ),
                update_source,
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
            update_source,
        )?;
    }

    // Update the response with the total request body size
    app_handle.with_tx(|tx| {
        debug!("Updating final body length {total_bytes}");
        if let Ok(mut response) = tx.get_http_response(&response_id) {
            response.request_content_length = Some(total_bytes as i32);
            tx.update_http_response_if_id(&response, update_source)?;
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
