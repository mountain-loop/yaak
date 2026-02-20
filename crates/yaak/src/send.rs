use crate::render::render_http_request;
use async_trait::async_trait;
use log::warn;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Instant;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::sync::watch;
use yaak_crypto::manager::EncryptionManager;
use yaak_http::client::{
    HttpConnectionOptions, HttpConnectionProxySetting, HttpConnectionProxySettingAuth,
};
use yaak_http::cookies::CookieStore;
use yaak_http::manager::HttpConnectionManager;
use yaak_http::sender::{HttpResponseEvent as SenderHttpResponseEvent, ReqwestSender};
use yaak_http::tee_reader::TeeReader;
use yaak_http::transaction::HttpTransaction;
use yaak_http::types::{
    SendableBody, SendableHttpRequest, SendableHttpRequestOptions, append_query_params,
};
use yaak_models::blob_manager::{BlobManager, BodyChunk};
use yaak_models::models::{
    ClientCertificate, CookieJar, DnsOverride, Environment, HttpRequest, HttpResponse,
    HttpResponseEvent, HttpResponseHeader, HttpResponseState, ProxySetting, ProxySettingAuth,
};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{UpdateSource, generate_prefixed_id};
use yaak_plugins::events::{
    CallHttpAuthenticationRequest, HttpHeader, PluginContext, RenderPurpose,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderOptions, TemplateCallback};
use yaak_tls::find_client_certificate;

const HTTP_EVENT_CHANNEL_CAPACITY: usize = 100;
const REQUEST_BODY_CHUNK_SIZE: usize = 1024 * 1024;
const RESPONSE_PROGRESS_UPDATE_INTERVAL_MS: u128 = 100;

#[derive(Debug, Error)]
pub enum SendHttpRequestError {
    #[error("Failed to load request: {0}")]
    LoadRequest(#[source] yaak_models::error::Error),

    #[error("Failed to load workspace: {0}")]
    LoadWorkspace(#[source] yaak_models::error::Error),

    #[error("Failed to resolve environments: {0}")]
    ResolveEnvironments(#[source] yaak_models::error::Error),

    #[error("Failed to resolve inherited request settings: {0}")]
    ResolveRequestInheritance(#[source] yaak_models::error::Error),

    #[error("Failed to load cookie jar: {0}")]
    LoadCookieJar(#[source] yaak_models::error::Error),

    #[error("Failed to persist cookie jar: {0}")]
    PersistCookieJar(#[source] yaak_models::error::Error),

    #[error("Failed to render request templates: {0}")]
    RenderRequest(#[source] yaak_templates::error::Error),

    #[error("Failed to prepare request before send: {0}")]
    PrepareSendableRequest(String),

    #[error("Failed to persist response metadata: {0}")]
    PersistResponse(#[source] yaak_models::error::Error),

    #[error("Failed to create HTTP client: {0}")]
    CreateHttpClient(#[source] yaak_http::error::Error),

    #[error("Failed to build sendable request: {0}")]
    BuildSendableRequest(#[source] yaak_http::error::Error),

    #[error("Failed to send request: {0}")]
    SendRequest(#[source] yaak_http::error::Error),

    #[error("Failed to read response body: {0}")]
    ReadResponseBody(#[source] yaak_http::error::Error),

    #[error("Failed to create response directory {path:?}: {source}")]
    CreateResponseDirectory {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to write response body to {path:?}: {source}")]
    WriteResponseBody {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

pub type Result<T> = std::result::Result<T, SendHttpRequestError>;

#[async_trait]
pub trait PrepareSendableRequest: Send + Sync {
    async fn prepare_sendable_request(
        &self,
        rendered_request: &HttpRequest,
        auth_context_id: &str,
        sendable_request: &mut SendableHttpRequest,
    ) -> std::result::Result<(), String>;
}

#[async_trait]
pub trait SendRequestExecutor: Send + Sync {
    async fn send(
        &self,
        sendable_request: SendableHttpRequest,
        event_tx: mpsc::Sender<SenderHttpResponseEvent>,
        cookie_store: Option<CookieStore>,
    ) -> yaak_http::error::Result<yaak_http::sender::HttpResponse>;
}

struct DefaultSendRequestExecutor;

#[async_trait]
impl SendRequestExecutor for DefaultSendRequestExecutor {
    async fn send(
        &self,
        sendable_request: SendableHttpRequest,
        event_tx: mpsc::Sender<SenderHttpResponseEvent>,
        cookie_store: Option<CookieStore>,
    ) -> yaak_http::error::Result<yaak_http::sender::HttpResponse> {
        let sender = ReqwestSender::new()?;
        let transaction = match cookie_store {
            Some(store) => HttpTransaction::with_cookie_store(sender, store),
            None => HttpTransaction::new(sender),
        };
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        transaction.execute_with_cancellation(sendable_request, cancel_rx, event_tx).await
    }
}

struct PluginPrepareSendableRequest {
    plugin_manager: Arc<PluginManager>,
    plugin_context: PluginContext,
    cancelled_rx: Option<watch::Receiver<bool>>,
}

#[async_trait]
impl PrepareSendableRequest for PluginPrepareSendableRequest {
    async fn prepare_sendable_request(
        &self,
        rendered_request: &HttpRequest,
        auth_context_id: &str,
        sendable_request: &mut SendableHttpRequest,
    ) -> std::result::Result<(), String> {
        if let Some(cancelled_rx) = &self.cancelled_rx {
            let mut cancelled_rx = cancelled_rx.clone();
            tokio::select! {
                result = apply_plugin_authentication(
                    sendable_request,
                    rendered_request,
                    auth_context_id,
                    &self.plugin_manager,
                    &self.plugin_context,
                ) => result,
                _ = cancelled_rx.changed() => Err("Request canceled".to_string()),
            }
        } else {
            apply_plugin_authentication(
                sendable_request,
                rendered_request,
                auth_context_id,
                &self.plugin_manager,
                &self.plugin_context,
            )
            .await
        }
    }
}

struct ConnectionManagerSendRequestExecutor<'a> {
    connection_manager: &'a HttpConnectionManager,
    plugin_context_id: String,
    query_manager: QueryManager,
    workspace_id: String,
    cancelled_rx: Option<watch::Receiver<bool>>,
}

#[async_trait]
impl SendRequestExecutor for ConnectionManagerSendRequestExecutor<'_> {
    async fn send(
        &self,
        sendable_request: SendableHttpRequest,
        event_tx: mpsc::Sender<SenderHttpResponseEvent>,
        cookie_store: Option<CookieStore>,
    ) -> yaak_http::error::Result<yaak_http::sender::HttpResponse> {
        let runtime_config =
            resolve_http_send_runtime_config(&self.query_manager, &self.workspace_id)
                .map_err(|e| yaak_http::error::Error::RequestError(e.to_string()))?;
        let client_certificate =
            find_client_certificate(&sendable_request.url, &runtime_config.client_certificates);
        let cached_client = self
            .connection_manager
            .get_client(&HttpConnectionOptions {
                id: self.plugin_context_id.clone(),
                validate_certificates: runtime_config.validate_certificates,
                proxy: runtime_config.proxy,
                client_certificate,
                dns_overrides: runtime_config.dns_overrides,
            })
            .await?;

        cached_client.resolver.set_event_sender(Some(event_tx.clone())).await;

        let sender = ReqwestSender::with_client(cached_client.client);
        let transaction = match cookie_store {
            Some(cs) => HttpTransaction::with_cookie_store(sender, cs),
            None => HttpTransaction::new(sender),
        };

        let result = if let Some(cancelled_rx) = self.cancelled_rx.clone() {
            transaction.execute_with_cancellation(sendable_request, cancelled_rx, event_tx).await
        } else {
            let (_cancel_tx, cancel_rx) = watch::channel(false);
            transaction.execute_with_cancellation(sendable_request, cancel_rx, event_tx).await
        };
        cached_client.resolver.set_event_sender(None).await;
        result
    }
}

pub struct SendHttpRequestByIdParams<'a, T: TemplateCallback> {
    pub query_manager: &'a QueryManager,
    pub blob_manager: &'a BlobManager,
    pub request_id: &'a str,
    pub environment_id: Option<&'a str>,
    pub template_callback: &'a T,
    pub update_source: UpdateSource,
    pub cookie_jar_id: Option<String>,
    pub response_dir: &'a Path,
    pub emit_events_to: Option<mpsc::Sender<SenderHttpResponseEvent>>,
    pub cancelled_rx: Option<watch::Receiver<bool>>,
    pub prepare_sendable_request: Option<&'a dyn PrepareSendableRequest>,
    pub executor: Option<&'a dyn SendRequestExecutor>,
}

pub struct SendHttpRequestParams<'a, T: TemplateCallback> {
    pub query_manager: &'a QueryManager,
    pub blob_manager: &'a BlobManager,
    pub request: HttpRequest,
    pub environment_id: Option<&'a str>,
    pub template_callback: &'a T,
    pub send_options: Option<SendableHttpRequestOptions>,
    pub update_source: UpdateSource,
    pub cookie_jar_id: Option<String>,
    pub response_dir: &'a Path,
    pub emit_events_to: Option<mpsc::Sender<SenderHttpResponseEvent>>,
    pub cancelled_rx: Option<watch::Receiver<bool>>,
    pub auth_context_id: Option<String>,
    pub existing_response: Option<HttpResponse>,
    pub prepare_sendable_request: Option<&'a dyn PrepareSendableRequest>,
    pub executor: Option<&'a dyn SendRequestExecutor>,
}

pub struct SendHttpRequestWithPluginsParams<'a> {
    pub query_manager: &'a QueryManager,
    pub blob_manager: &'a BlobManager,
    pub request: HttpRequest,
    pub environment_id: Option<&'a str>,
    pub update_source: UpdateSource,
    pub cookie_jar_id: Option<String>,
    pub response_dir: &'a Path,
    pub emit_events_to: Option<mpsc::Sender<SenderHttpResponseEvent>>,
    pub existing_response: Option<HttpResponse>,
    pub plugin_manager: Arc<PluginManager>,
    pub encryption_manager: Arc<EncryptionManager>,
    pub plugin_context: &'a PluginContext,
    pub cancelled_rx: Option<watch::Receiver<bool>>,
    pub connection_manager: Option<&'a HttpConnectionManager>,
}

pub struct SendHttpRequestByIdWithPluginsParams<'a> {
    pub query_manager: &'a QueryManager,
    pub blob_manager: &'a BlobManager,
    pub request_id: &'a str,
    pub environment_id: Option<&'a str>,
    pub update_source: UpdateSource,
    pub cookie_jar_id: Option<String>,
    pub response_dir: &'a Path,
    pub emit_events_to: Option<mpsc::Sender<SenderHttpResponseEvent>>,
    pub plugin_manager: Arc<PluginManager>,
    pub encryption_manager: Arc<EncryptionManager>,
    pub plugin_context: &'a PluginContext,
    pub cancelled_rx: Option<watch::Receiver<bool>>,
    pub connection_manager: Option<&'a HttpConnectionManager>,
}

pub struct SendHttpRequestResult {
    pub rendered_request: HttpRequest,
    pub response: HttpResponse,
    pub response_body: Vec<u8>,
}

pub struct HttpSendRuntimeConfig {
    pub send_options: SendableHttpRequestOptions,
    pub validate_certificates: bool,
    pub proxy: HttpConnectionProxySetting,
    pub dns_overrides: Vec<DnsOverride>,
    pub client_certificates: Vec<ClientCertificate>,
}

pub fn resolve_http_send_runtime_config(
    query_manager: &QueryManager,
    workspace_id: &str,
) -> Result<HttpSendRuntimeConfig> {
    let db = query_manager.connect();
    let workspace = db.get_workspace(workspace_id).map_err(SendHttpRequestError::LoadWorkspace)?;
    let settings = db.get_settings();

    Ok(HttpSendRuntimeConfig {
        send_options: SendableHttpRequestOptions {
            follow_redirects: workspace.setting_follow_redirects,
            timeout: if workspace.setting_request_timeout > 0 {
                Some(std::time::Duration::from_millis(
                    workspace.setting_request_timeout.unsigned_abs() as u64,
                ))
            } else {
                None
            },
        },
        validate_certificates: workspace.setting_validate_certificates,
        proxy: proxy_setting_from_settings(settings.proxy),
        dns_overrides: workspace.setting_dns_overrides,
        client_certificates: settings.client_certificates,
    })
}

pub async fn send_http_request_by_id_with_plugins(
    params: SendHttpRequestByIdWithPluginsParams<'_>,
) -> Result<SendHttpRequestResult> {
    let request = params
        .query_manager
        .connect()
        .get_http_request(params.request_id)
        .map_err(SendHttpRequestError::LoadRequest)?;

    send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
        query_manager: params.query_manager,
        blob_manager: params.blob_manager,
        request,
        environment_id: params.environment_id,
        update_source: params.update_source,
        cookie_jar_id: params.cookie_jar_id,
        response_dir: params.response_dir,
        emit_events_to: params.emit_events_to,
        existing_response: None,
        plugin_manager: params.plugin_manager,
        encryption_manager: params.encryption_manager,
        plugin_context: params.plugin_context,
        cancelled_rx: params.cancelled_rx,
        connection_manager: params.connection_manager,
    })
    .await
}

pub async fn send_http_request_with_plugins(
    params: SendHttpRequestWithPluginsParams<'_>,
) -> Result<SendHttpRequestResult> {
    let template_callback = PluginTemplateCallback::new(
        params.plugin_manager.clone(),
        params.encryption_manager.clone(),
        params.plugin_context,
        RenderPurpose::Send,
    );
    let auth_hook = PluginPrepareSendableRequest {
        plugin_manager: params.plugin_manager,
        plugin_context: params.plugin_context.clone(),
        cancelled_rx: params.cancelled_rx.clone(),
    };
    let executor =
        params.connection_manager.map(|connection_manager| ConnectionManagerSendRequestExecutor {
            connection_manager,
            plugin_context_id: params.plugin_context.id.clone(),
            query_manager: params.query_manager.clone(),
            workspace_id: params.request.workspace_id.clone(),
            cancelled_rx: params.cancelled_rx.clone(),
        });

    send_http_request(SendHttpRequestParams {
        query_manager: params.query_manager,
        blob_manager: params.blob_manager,
        request: params.request,
        environment_id: params.environment_id,
        template_callback: &template_callback,
        send_options: None,
        update_source: params.update_source,
        cookie_jar_id: params.cookie_jar_id,
        response_dir: params.response_dir,
        emit_events_to: params.emit_events_to,
        cancelled_rx: params.cancelled_rx,
        auth_context_id: None,
        existing_response: params.existing_response,
        prepare_sendable_request: Some(&auth_hook),
        executor: executor.as_ref().map(|e| e as &dyn SendRequestExecutor),
    })
    .await
}

pub async fn send_http_request_by_id<T: TemplateCallback>(
    params: SendHttpRequestByIdParams<'_, T>,
) -> Result<SendHttpRequestResult> {
    let request = params
        .query_manager
        .connect()
        .get_http_request(params.request_id)
        .map_err(SendHttpRequestError::LoadRequest)?;
    let (request, auth_context_id) = resolve_inherited_request(params.query_manager, &request)?;

    send_http_request(SendHttpRequestParams {
        query_manager: params.query_manager,
        blob_manager: params.blob_manager,
        request,
        environment_id: params.environment_id,
        template_callback: params.template_callback,
        send_options: None,
        update_source: params.update_source,
        cookie_jar_id: params.cookie_jar_id,
        response_dir: params.response_dir,
        emit_events_to: params.emit_events_to,
        cancelled_rx: params.cancelled_rx,
        existing_response: None,
        prepare_sendable_request: params.prepare_sendable_request,
        executor: params.executor,
        auth_context_id: Some(auth_context_id),
    })
    .await
}

pub async fn send_http_request<T: TemplateCallback>(
    params: SendHttpRequestParams<'_, T>,
) -> Result<SendHttpRequestResult> {
    let environment_chain =
        resolve_environment_chain(params.query_manager, &params.request, params.environment_id)?;
    let (resolved_request, auth_context_id) =
        if let Some(auth_context_id) = params.auth_context_id.clone() {
            (params.request.clone(), auth_context_id)
        } else {
            resolve_inherited_request(params.query_manager, &params.request)?
        };
    let runtime_config =
        resolve_http_send_runtime_config(params.query_manager, &params.request.workspace_id)?;
    let send_options = params.send_options.unwrap_or(runtime_config.send_options);
    let mut cookie_jar = load_cookie_jar(params.query_manager, params.cookie_jar_id.as_deref())?;
    let cookie_store =
        cookie_jar.as_ref().map(|jar| CookieStore::from_cookies(jar.cookies.clone()));

    let rendered_request = render_http_request(
        &resolved_request,
        environment_chain,
        params.template_callback,
        &RenderOptions::throw(),
    )
    .await
    .map_err(SendHttpRequestError::RenderRequest)?;

    let mut sendable_request =
        SendableHttpRequest::from_http_request(&rendered_request, send_options)
            .await
            .map_err(SendHttpRequestError::BuildSendableRequest)?;

    if let Some(hook) = params.prepare_sendable_request {
        hook.prepare_sendable_request(&rendered_request, &auth_context_id, &mut sendable_request)
            .await
            .map_err(SendHttpRequestError::PrepareSendableRequest)?;
    }

    let request_content_length = sendable_body_length(sendable_request.body.as_ref());
    let mut response = params.existing_response.unwrap_or_default();
    response.request_id = params.request.id.clone();
    response.workspace_id = params.request.workspace_id.clone();
    response.request_content_length = request_content_length;
    response.request_headers = sendable_request
        .headers
        .iter()
        .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
        .collect();
    response.url = sendable_request.url.clone();
    response.state = HttpResponseState::Initialized;
    response.error = None;
    response.content_length = None;
    response.content_length_compressed = None;
    response.body_path = None;
    response.status = 0;
    response.status_reason = None;
    response.headers = Vec::new();
    response.remote_addr = None;
    response.version = None;
    response.elapsed = 0;
    response.elapsed_headers = 0;
    response.elapsed_dns = 0;
    let persist_response = !response.request_id.is_empty();
    if persist_response {
        response = params
            .query_manager
            .connect()
            .upsert_http_response(&response, &params.update_source, params.blob_manager)
            .map_err(SendHttpRequestError::PersistResponse)?;
    } else if response.id.is_empty() {
        response.id = generate_prefixed_id("rs");
    }

    let request_body_id = format!("{}.request", response.id);
    let mut request_body_capture_task = None;
    let mut request_body_capture_error = None;
    if persist_response {
        match sendable_request.body.as_mut() {
            Some(SendableBody::Bytes(bytes)) => {
                if let Err(err) = persist_request_body_bytes(
                    params.blob_manager,
                    &request_body_id,
                    bytes.as_ref(),
                ) {
                    request_body_capture_error = Some(err);
                }
            }
            Some(SendableBody::Stream { data, .. }) => {
                let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
                let inner = std::mem::replace(data, Box::pin(tokio::io::empty()));
                let tee_reader = TeeReader::new(inner, tx);
                *data = Box::pin(tee_reader);
                let blob_manager = params.blob_manager.clone();
                let body_id = request_body_id.clone();
                request_body_capture_task = Some(tokio::spawn(async move {
                    persist_request_body_stream(blob_manager, body_id, rx).await
                }));
            }
            None => {}
        }
    }

    let (event_tx, mut event_rx) =
        mpsc::channel::<SenderHttpResponseEvent>(HTTP_EVENT_CHANNEL_CAPACITY);
    let event_query_manager = params.query_manager.clone();
    let event_response_id = response.id.clone();
    let event_workspace_id = params.request.workspace_id.clone();
    let event_update_source = params.update_source.clone();
    let emit_events_to = params.emit_events_to.clone();
    let dns_elapsed = Arc::new(AtomicI32::new(0));
    let event_dns_elapsed = dns_elapsed.clone();
    let event_handle = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if let SenderHttpResponseEvent::DnsResolved { duration, .. } = &event {
                event_dns_elapsed.store(u64_to_i32(*duration), Ordering::Relaxed);
            }

            if persist_response {
                let db_event = HttpResponseEvent::new(
                    &event_response_id,
                    &event_workspace_id,
                    event.clone().into(),
                );
                if let Err(err) = event_query_manager
                    .connect()
                    .upsert_http_response_event(&db_event, &event_update_source)
                {
                    warn!("Failed to persist HTTP response event: {}", err);
                }
            }

            if let Some(tx) = emit_events_to.as_ref() {
                let _ = tx.try_send(event);
            }
        }
    });

    let default_executor = DefaultSendRequestExecutor;
    let executor = params.executor.unwrap_or(&default_executor);
    let started_at = Instant::now();
    let request_started_url = sendable_request.url.clone();

    let mut http_response = match executor
        .send(sendable_request, event_tx, cookie_store.clone())
        .await
    {
        Ok(response) => response,
        Err(err) => {
            persist_cookie_jar(params.query_manager, cookie_jar.as_mut(), cookie_store.as_ref())?;
            if persist_response {
                let _ = persist_response_error(
                    params.query_manager,
                    params.blob_manager,
                    &params.update_source,
                    &response,
                    started_at,
                    err.to_string(),
                    request_started_url,
                );
            }
            if let Err(join_err) = event_handle.await {
                warn!("Failed to join response event task: {}", join_err);
            }
            if let Some(task) = request_body_capture_task.take() {
                let _ = task.await;
            }
            return Err(SendHttpRequestError::SendRequest(err));
        }
    };

    let headers_elapsed = duration_to_i32(started_at.elapsed());
    std::fs::create_dir_all(params.response_dir).map_err(|source| {
        SendHttpRequestError::CreateResponseDirectory {
            path: params.response_dir.to_path_buf(),
            source,
        }
    })?;
    let body_path = params.response_dir.join(&response.id);
    let connected_response = HttpResponse {
        state: HttpResponseState::Connected,
        elapsed_headers: headers_elapsed,
        status: i32::from(http_response.status),
        status_reason: http_response.status_reason.clone(),
        url: http_response.url.clone(),
        remote_addr: http_response.remote_addr.clone(),
        version: http_response.version.clone(),
        elapsed_dns: dns_elapsed.load(Ordering::Relaxed),
        body_path: Some(body_path.to_string_lossy().to_string()),
        content_length: http_response.content_length.map(u64_to_i32),
        headers: http_response
            .headers
            .iter()
            .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
            .collect(),
        request_headers: http_response
            .request_headers
            .iter()
            .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
            .collect(),
        ..response
    };
    if persist_response {
        response = params
            .query_manager
            .connect()
            .upsert_http_response(&connected_response, &params.update_source, params.blob_manager)
            .map_err(SendHttpRequestError::PersistResponse)?;
    } else {
        response = connected_response;
    }

    let mut file =
        File::options().create(true).truncate(true).write(true).open(&body_path).await.map_err(
            |source| SendHttpRequestError::WriteResponseBody { path: body_path.clone(), source },
        )?;
    let mut body_stream =
        http_response.into_body_stream().map_err(SendHttpRequestError::ReadResponseBody)?;
    let mut response_body = Vec::new();
    let mut body_read_error = None;
    let mut written_bytes: usize = 0;
    let mut last_progress_update = started_at;
    let mut cancelled_rx = params.cancelled_rx.clone();

    loop {
        let read_result = if let Some(cancelled_rx) = cancelled_rx.as_mut() {
            if *cancelled_rx.borrow() {
                break;
            }

            tokio::select! {
                biased;
                _ = cancelled_rx.changed() => {
                    None
                }
                result = body_stream.read_buf(&mut response_body) => {
                    Some(result)
                }
            }
        } else {
            Some(body_stream.read_buf(&mut response_body).await)
        };

        let Some(read_result) = read_result else {
            break;
        };

        match read_result {
            Ok(0) => break,
            Ok(n) => {
                written_bytes += n;
                let start_idx = response_body.len() - n;
                file.write_all(&response_body[start_idx..]).await.map_err(|source| {
                    SendHttpRequestError::WriteResponseBody { path: body_path.clone(), source }
                })?;
                file.flush().await.map_err(|source| SendHttpRequestError::WriteResponseBody {
                    path: body_path.clone(),
                    source,
                })?;

                let now = Instant::now();
                let should_update = now.duration_since(last_progress_update).as_millis()
                    >= RESPONSE_PROGRESS_UPDATE_INTERVAL_MS;
                if should_update {
                    let elapsed = duration_to_i32(started_at.elapsed());
                    let progress_response = HttpResponse {
                        elapsed,
                        content_length: Some(usize_to_i32(written_bytes)),
                        elapsed_dns: dns_elapsed.load(Ordering::Relaxed),
                        ..response.clone()
                    };
                    if persist_response {
                        response = params
                            .query_manager
                            .connect()
                            .upsert_http_response(
                                &progress_response,
                                &params.update_source,
                                params.blob_manager,
                            )
                            .map_err(SendHttpRequestError::PersistResponse)?;
                    } else {
                        response = progress_response;
                    }
                    last_progress_update = now;
                }
            }
            Err(err) => {
                body_read_error = Some(SendHttpRequestError::ReadResponseBody(
                    yaak_http::error::Error::BodyReadError(err.to_string()),
                ));
                break;
            }
        }
    }

    file.flush().await.map_err(|source| SendHttpRequestError::WriteResponseBody {
        path: body_path.clone(),
        source,
    })?;
    drop(body_stream);

    if let Some(task) = request_body_capture_task.take() {
        match task.await {
            Ok(Ok(total)) => {
                response.request_content_length = Some(usize_to_i32(total));
            }
            Ok(Err(err)) => request_body_capture_error = Some(err),
            Err(err) => request_body_capture_error = Some(err.to_string()),
        }
    }

    if let Some(err) = request_body_capture_error.take() {
        response.error = Some(append_error_message(
            response.error.take(),
            format!("Request succeeded but failed to store request body: {err}"),
        ));
    }

    if let Err(join_err) = event_handle.await {
        warn!("Failed to join response event task: {}", join_err);
    }

    if let Some(err) = body_read_error {
        if persist_response {
            let _ = persist_response_error(
                params.query_manager,
                params.blob_manager,
                &params.update_source,
                &response,
                started_at,
                err.to_string(),
                request_started_url,
            );
        }
        persist_cookie_jar(params.query_manager, cookie_jar.as_mut(), cookie_store.as_ref())?;
        return Err(err);
    }

    let compressed_length = http_response.content_length.unwrap_or(written_bytes as u64);
    let final_response = HttpResponse {
        body_path: Some(body_path.to_string_lossy().to_string()),
        content_length: Some(usize_to_i32(written_bytes)),
        content_length_compressed: Some(u64_to_i32(compressed_length)),
        elapsed: duration_to_i32(started_at.elapsed()),
        elapsed_headers: headers_elapsed,
        elapsed_dns: dns_elapsed.load(Ordering::Relaxed),
        state: HttpResponseState::Closed,
        ..response
    };
    if persist_response {
        response = params
            .query_manager
            .connect()
            .upsert_http_response(&final_response, &params.update_source, params.blob_manager)
            .map_err(SendHttpRequestError::PersistResponse)?;
    } else {
        response = final_response;
    }

    persist_cookie_jar(params.query_manager, cookie_jar.as_mut(), cookie_store.as_ref())?;

    Ok(SendHttpRequestResult { rendered_request, response, response_body })
}

fn persist_request_body_bytes(
    blob_manager: &BlobManager,
    body_id: &str,
    bytes: &[u8],
) -> std::result::Result<(), String> {
    if bytes.is_empty() {
        return Ok(());
    }

    let blob_ctx = blob_manager.connect();
    let mut offset = 0;
    let mut chunk_index: i32 = 0;
    while offset < bytes.len() {
        let end = std::cmp::min(offset + REQUEST_BODY_CHUNK_SIZE, bytes.len());
        let chunk = BodyChunk::new(body_id, chunk_index, bytes[offset..end].to_vec());
        blob_ctx.insert_chunk(&chunk).map_err(|e| e.to_string())?;
        chunk_index += 1;
        offset = end;
    }
    Ok(())
}

async fn persist_request_body_stream(
    blob_manager: BlobManager,
    body_id: String,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) -> std::result::Result<usize, String> {
    let mut chunk_index: i32 = 0;
    let mut total_bytes = 0usize;
    while let Some(data) = rx.recv().await {
        total_bytes += data.len();
        if data.is_empty() {
            continue;
        }
        let chunk = BodyChunk::new(&body_id, chunk_index, data);
        blob_manager.connect().insert_chunk(&chunk).map_err(|e| e.to_string())?;
        chunk_index += 1;
    }

    Ok(total_bytes)
}

fn append_error_message(existing_error: Option<String>, message: String) -> String {
    match existing_error {
        Some(existing) => format!("{existing}; {message}"),
        None => message,
    }
}

fn resolve_environment_chain(
    query_manager: &QueryManager,
    request: &HttpRequest,
    environment_id: Option<&str>,
) -> Result<Vec<Environment>> {
    let db = query_manager.connect();
    db.resolve_environments(&request.workspace_id, request.folder_id.as_deref(), environment_id)
        .map_err(SendHttpRequestError::ResolveEnvironments)
}

fn resolve_inherited_request(
    query_manager: &QueryManager,
    request: &HttpRequest,
) -> Result<(HttpRequest, String)> {
    let db = query_manager.connect();
    let (authentication_type, authentication, auth_context_id) = db
        .resolve_auth_for_http_request(request)
        .map_err(SendHttpRequestError::ResolveRequestInheritance)?;
    let resolved_headers = db
        .resolve_headers_for_http_request(request)
        .map_err(SendHttpRequestError::ResolveRequestInheritance)?;

    let mut request = request.clone();
    request.authentication_type = authentication_type;
    request.authentication = authentication;
    request.headers = resolved_headers;

    Ok((request, auth_context_id))
}

fn load_cookie_jar(
    query_manager: &QueryManager,
    cookie_jar_id: Option<&str>,
) -> Result<Option<CookieJar>> {
    let Some(cookie_jar_id) = cookie_jar_id else {
        return Ok(None);
    };

    query_manager
        .connect()
        .get_cookie_jar(cookie_jar_id)
        .map(Some)
        .map_err(SendHttpRequestError::LoadCookieJar)
}

fn persist_cookie_jar(
    query_manager: &QueryManager,
    cookie_jar: Option<&mut CookieJar>,
    cookie_store: Option<&CookieStore>,
) -> Result<()> {
    match (cookie_jar, cookie_store) {
        (Some(cookie_jar), Some(cookie_store)) => {
            cookie_jar.cookies = cookie_store.get_all_cookies();
            query_manager
                .connect()
                .upsert_cookie_jar(cookie_jar, &UpdateSource::Background)
                .map_err(SendHttpRequestError::PersistCookieJar)?;
            Ok(())
        }
        _ => Ok(()),
    }
}

fn proxy_setting_from_settings(proxy: Option<ProxySetting>) -> HttpConnectionProxySetting {
    match proxy {
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
                    auth: auth.map(|ProxySettingAuth { user, password }| {
                        HttpConnectionProxySettingAuth { user, password }
                    }),
                }
            }
        }
    }
}

pub async fn apply_plugin_authentication(
    sendable_request: &mut SendableHttpRequest,
    request: &HttpRequest,
    auth_context_id: &str,
    plugin_manager: &PluginManager,
    plugin_context: &PluginContext,
) -> std::result::Result<(), String> {
    match &request.authentication_type {
        None => {}
        Some(authentication_type) if authentication_type == "none" => {}
        Some(authentication_type) => {
            let req = CallHttpAuthenticationRequest {
                context_id: format!("{:x}", md5::compute(auth_context_id)),
                values: serde_json::from_value(
                    serde_json::to_value(&request.authentication)
                        .map_err(|e| format!("Failed to serialize auth values: {e}"))?,
                )
                .map_err(|e| format!("Failed to parse auth values: {e}"))?,
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
                .call_http_authentication(plugin_context, authentication_type, req)
                .await
                .map_err(|e| format!("Failed to apply authentication plugin: {e}"))?;

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

fn persist_response_error(
    query_manager: &QueryManager,
    blob_manager: &BlobManager,
    update_source: &UpdateSource,
    response: &HttpResponse,
    started_at: Instant,
    error: String,
    fallback_url: String,
) -> Result<HttpResponse> {
    let elapsed = duration_to_i32(started_at.elapsed());
    query_manager
        .connect()
        .upsert_http_response(
            &HttpResponse {
                state: HttpResponseState::Closed,
                elapsed,
                elapsed_headers: if response.elapsed_headers == 0 {
                    elapsed
                } else {
                    response.elapsed_headers
                },
                error: Some(error),
                url: if response.url.is_empty() { fallback_url } else { response.url.clone() },
                ..response.clone()
            },
            update_source,
            blob_manager,
        )
        .map_err(SendHttpRequestError::PersistResponse)
}

fn sendable_body_length(body: Option<&SendableBody>) -> Option<i32> {
    match body {
        Some(SendableBody::Bytes(bytes)) => Some(usize_to_i32(bytes.len())),
        Some(SendableBody::Stream { content_length: Some(length), .. }) => {
            Some(u64_to_i32(*length))
        }
        _ => None,
    }
}

fn duration_to_i32(duration: std::time::Duration) -> i32 {
    u128_to_i32(duration.as_millis())
}

fn usize_to_i32(value: usize) -> i32 {
    if value > i32::MAX as usize { i32::MAX } else { value as i32 }
}

fn u64_to_i32(value: u64) -> i32 {
    if value > i32::MAX as u64 { i32::MAX } else { value as i32 }
}

fn u128_to_i32(value: u128) -> i32 {
    if value > i32::MAX as u128 { i32::MAX } else { value as i32 }
}
