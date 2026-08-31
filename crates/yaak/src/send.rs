use async_trait::async_trait;
use log::warn;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::{Duration, Instant};
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
    ClientCertificate, Cookie, CookieJar, DnsOverride, Environment, HttpRequest, HttpResponse,
    HttpResponseEvent, HttpResponseEventData, HttpResponseHeader, HttpResponseState, ProxySetting,
    ProxySettingAuth, ResolvedHttpRequestSettings,
};
use yaak_models::query_manager::QueryManager;
use yaak_models::render::render_http_request;
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
const MAX_AUTH_BODY_BYTES: usize = 10 * 1024 * 1024;

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
        cookie_behavior: CookieBehavior,
    ) -> yaak_http::error::Result<yaak_http::sender::HttpResponse>;
}

#[derive(Clone)]
pub struct CookieBehavior {
    pub store: Option<CookieStore>,
    pub send_cookies: bool,
    pub store_cookies: bool,
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
    runtime_config: HttpSendRuntimeConfig,
    cancelled_rx: Option<watch::Receiver<bool>>,
}

#[async_trait]
impl SendRequestExecutor for ConnectionManagerSendRequestExecutor<'_> {
    async fn send(
        &self,
        sendable_request: SendableHttpRequest,
        event_tx: mpsc::Sender<SenderHttpResponseEvent>,
        cookie_behavior: CookieBehavior,
    ) -> yaak_http::error::Result<yaak_http::sender::HttpResponse> {
        let runtime_config = &self.runtime_config;
        let client_certificate =
            find_client_certificate(&sendable_request.url, &runtime_config.client_certificates);
        let cached_client = self
            .connection_manager
            .get_client(&HttpConnectionOptions {
                id: self.plugin_context_id.clone(),
                validate_certificates: runtime_config.settings.validate_certificates.value,
                http_version: runtime_config.settings.http_version.value,
                proxy: runtime_config.proxy.clone(),
                client_certificate,
                dns_overrides: runtime_config.dns_overrides.clone(),
                address_filter: None,
            })
            .await?;

        cached_client.resolver.set_event_sender(Some(event_tx.clone())).await;

        let sender = ReqwestSender::with_client(cached_client.client);
        let transaction = match cookie_behavior.store {
            Some(cs) => HttpTransaction::with_cookie_behavior(
                sender,
                cs,
                cookie_behavior.send_cookies,
                cookie_behavior.store_cookies,
            ),
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
    pub emit_response_body_chunks_to: Option<mpsc::UnboundedSender<Vec<u8>>>,
    pub cancelled_rx: Option<watch::Receiver<bool>>,
    pub prepare_sendable_request: Option<&'a dyn PrepareSendableRequest>,
    pub executor: &'a dyn SendRequestExecutor,
}

/// An [`HttpRequest`] carrying the authentication and headers it inherits from its folder or
/// workspace, alongside the id of the model that authentication came from.
///
/// Sending requires inheritance to be applied first, and this type is the only way to say it has
/// been. There is no public constructor beyond [`resolve_inherited_request`], which resolves it
/// against a database, and [`ResolvedHttpRequest::assume_resolved`], which a caller without a
/// database must name explicitly — so skipping inheritance is a deliberate, greppable act rather
/// than something a new call site forgets.
#[derive(Clone)]
pub struct ResolvedHttpRequest {
    request: HttpRequest,
    auth_context_id: String,
}

impl ResolvedHttpRequest {
    /// Declare a request already resolved, for callers with no database to resolve against. The
    /// caller owns the promise that inherited authentication and headers are applied.
    pub fn assume_resolved(request: HttpRequest, auth_context_id: String) -> Self {
        Self { request, auth_context_id }
    }

    pub fn request(&self) -> &HttpRequest {
        &self.request
    }

    pub fn auth_context_id(&self) -> &str {
        &self.auth_context_id
    }

    fn into_parts(self) -> (HttpRequest, String) {
        (self.request, self.auth_context_id)
    }
}

/// Everything a send needs that would otherwise be read from the database.
///
/// Callers backed by a database build this with [`resolve_send_inputs`]. A stateless caller
/// constructs it directly, which is what lets [`send_http_request`] run with no database at all.
pub struct HttpSendInputs {
    pub request: ResolvedHttpRequest,
    pub environment_chain: Vec<Environment>,
    pub runtime_config: HttpSendRuntimeConfig,
    /// Cookies the send starts with. The store is shared, so reading it back after the send
    /// returns (or fails) yields the cookies the transaction collected.
    pub cookie_store: Option<CookieStore>,
}

/// Where a send writes its response. Without it, the send keeps everything in memory: no
/// response body file, no model writes, and no timeline rows.
pub struct ResponseStorage<'a> {
    pub query_manager: &'a QueryManager,
    pub blob_manager: &'a BlobManager,
    pub update_source: UpdateSource,
    pub response_dir: &'a Path,
}

pub struct SendHttpRequestParams<'a, T: TemplateCallback> {
    pub inputs: HttpSendInputs,
    pub template_callback: &'a T,
    pub storage: Option<ResponseStorage<'a>>,
    pub emit_events_to: Option<mpsc::Sender<SenderHttpResponseEvent>>,
    pub emit_response_body_chunks_to: Option<mpsc::UnboundedSender<Vec<u8>>>,
    pub cancelled_rx: Option<watch::Receiver<bool>>,
    pub existing_response: Option<HttpResponse>,
    pub prepare_sendable_request: Option<&'a dyn PrepareSendableRequest>,
    pub executor: &'a dyn SendRequestExecutor,
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
    pub emit_response_body_chunks_to: Option<mpsc::UnboundedSender<Vec<u8>>>,
    pub existing_response: Option<HttpResponse>,
    pub plugin_manager: Arc<PluginManager>,
    pub encryption_manager: Arc<EncryptionManager>,
    pub plugin_context: &'a PluginContext,
    pub cancelled_rx: Option<watch::Receiver<bool>>,
    pub connection_manager: &'a HttpConnectionManager,
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
    pub emit_response_body_chunks_to: Option<mpsc::UnboundedSender<Vec<u8>>>,
    pub plugin_manager: Arc<PluginManager>,
    pub encryption_manager: Arc<EncryptionManager>,
    pub plugin_context: &'a PluginContext,
    pub cancelled_rx: Option<watch::Receiver<bool>>,
    pub connection_manager: &'a HttpConnectionManager,
}

/// Where a send left the response body, so the caller knows where to get it.
///
/// The body goes to exactly one place, and which one depends on what the caller
/// asked for. Saying so outright beats handing back a `Vec` that is empty for
/// two entirely different reasons.
pub enum ResponseBody {
    /// Written to the response's own file. Read it back by response id.
    Stored,
    /// Sent to the chunk sender the caller supplied, as it arrived.
    Streamed,
    /// Here it is, because nothing else kept it. Empty means the response
    /// really had no body.
    Returned(Vec<u8>),
}

impl ResponseBody {
    /// The bytes, when this is the only copy of them.
    ///
    /// Stored and streamed bodies belong to whoever holds them; only `Returned`
    /// has to travel back to the caller.
    pub fn returned_bytes(&self) -> Option<&[u8]> {
        match self {
            ResponseBody::Returned(bytes) => Some(bytes),
            ResponseBody::Stored | ResponseBody::Streamed => None,
        }
    }
}

pub struct SendHttpRequestResult {
    pub rendered_request: HttpRequest,
    pub response: HttpResponse,
    pub response_body: ResponseBody,
    /// The cookies held by the jar after the send, for callers that persist
    /// one. `None` when the caller supplied no jar, which is independent of
    /// where the body went.
    pub cookies: Option<Vec<Cookie>>,
}

#[derive(Clone)]
pub struct HttpSendRuntimeConfig {
    pub settings: ResolvedHttpRequestSettings,
    pub proxy: HttpConnectionProxySetting,
    pub dns_overrides: Vec<DnsOverride>,
    pub client_certificates: Vec<ClientCertificate>,
}

impl HttpSendRuntimeConfig {
    pub fn send_options(&self) -> SendableHttpRequestOptions {
        SendableHttpRequestOptions {
            follow_redirects: self.settings.follow_redirects.value,
            timeout: if self.settings.request_timeout.value > 0 {
                Some(Duration::from_millis(
                    self.settings.request_timeout.value.unsigned_abs() as u64
                ))
            } else {
                None
            },
        }
    }
}

/// Resolve every database-backed input a send needs, in one pass.
pub fn resolve_send_inputs(
    query_manager: &QueryManager,
    request: &HttpRequest,
    environment_id: Option<&str>,
    cookies: Option<Vec<Cookie>>,
) -> Result<HttpSendInputs> {
    let db = query_manager.connect();

    let environment_chain = db
        .resolve_environments(&request.workspace_id, request.folder_id.as_deref(), environment_id)
        .map_err(SendHttpRequestError::ResolveEnvironments)?;

    let resolved_request = resolve_inherited_request(query_manager, request)?;

    let workspace =
        db.get_workspace(&request.workspace_id).map_err(SendHttpRequestError::LoadWorkspace)?;
    let settings = db.get_settings();
    let resolved_settings = db
        .resolve_settings_for_http_request(request)
        .map_err(SendHttpRequestError::ResolveRequestInheritance)?;

    Ok(HttpSendInputs {
        request: resolved_request,
        environment_chain,
        runtime_config: HttpSendRuntimeConfig {
            settings: resolved_settings,
            proxy: proxy_setting_from_settings(settings.proxy),
            dns_overrides: workspace.setting_dns_overrides,
            client_certificates: settings.client_certificates,
        },
        cookie_store: cookies.map(CookieStore::from_cookies),
    })
}

/// Apply the authentication and headers a request inherits from its folder or workspace.
pub fn resolve_inherited_request(
    query_manager: &QueryManager,
    request: &HttpRequest,
) -> Result<ResolvedHttpRequest> {
    let db = query_manager.connect();
    let (authentication_type, authentication, auth_context_id) = db
        .resolve_auth_for_http_request(request)
        .map_err(SendHttpRequestError::ResolveRequestInheritance)?;
    let headers = db
        .resolve_headers_for_http_request(request)
        .map_err(SendHttpRequestError::ResolveRequestInheritance)?;

    Ok(ResolvedHttpRequest {
        request: HttpRequest { authentication_type, authentication, headers, ..request.clone() },
        auth_context_id,
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
        emit_response_body_chunks_to: params.emit_response_body_chunks_to,
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
    let mut cookie_jar = load_cookie_jar(params.query_manager, params.cookie_jar_id.as_deref())?;
    let inputs = resolve_send_inputs(
        params.query_manager,
        &params.request,
        params.environment_id,
        cookie_jar.as_ref().map(|jar| jar.cookies.clone()),
    )?;

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
    let executor = ConnectionManagerSendRequestExecutor {
        connection_manager: params.connection_manager,
        plugin_context_id: params.plugin_context.id.clone(),
        runtime_config: inputs.runtime_config.clone(),
        cancelled_rx: params.cancelled_rx.clone(),
    };
    let cookie_store = inputs.cookie_store.clone();

    let result = send_http_request(SendHttpRequestParams {
        inputs,
        template_callback: &template_callback,
        storage: Some(ResponseStorage {
            query_manager: params.query_manager,
            blob_manager: params.blob_manager,
            update_source: params.update_source,
            response_dir: params.response_dir,
        }),
        emit_events_to: params.emit_events_to,
        emit_response_body_chunks_to: params.emit_response_body_chunks_to,
        cancelled_rx: params.cancelled_rx,
        existing_response: params.existing_response,
        prepare_sendable_request: Some(&auth_hook),
        executor: &executor,
    })
    .await;

    persist_cookies_after_send(params.query_manager, cookie_jar.as_mut(), cookie_store.as_ref())?;

    result
}

pub async fn send_http_request_by_id<T: TemplateCallback>(
    params: SendHttpRequestByIdParams<'_, T>,
) -> Result<SendHttpRequestResult> {
    let request = params
        .query_manager
        .connect()
        .get_http_request(params.request_id)
        .map_err(SendHttpRequestError::LoadRequest)?;
    let mut cookie_jar = load_cookie_jar(params.query_manager, params.cookie_jar_id.as_deref())?;
    let inputs = resolve_send_inputs(
        params.query_manager,
        &request,
        params.environment_id,
        cookie_jar.as_ref().map(|jar| jar.cookies.clone()),
    )?;
    let cookie_store = inputs.cookie_store.clone();

    let result = send_http_request(SendHttpRequestParams {
        inputs,
        template_callback: params.template_callback,
        storage: Some(ResponseStorage {
            query_manager: params.query_manager,
            blob_manager: params.blob_manager,
            update_source: params.update_source,
            response_dir: params.response_dir,
        }),
        emit_events_to: params.emit_events_to,
        emit_response_body_chunks_to: params.emit_response_body_chunks_to,
        cancelled_rx: params.cancelled_rx,
        existing_response: None,
        prepare_sendable_request: params.prepare_sendable_request,
        executor: params.executor,
    })
    .await;

    persist_cookies_after_send(params.query_manager, cookie_jar.as_mut(), cookie_store.as_ref())?;

    result
}

pub async fn send_http_request<T: TemplateCallback>(
    params: SendHttpRequestParams<'_, T>,
) -> Result<SendHttpRequestResult> {
    let HttpSendInputs { request, environment_chain, runtime_config, cookie_store } = params.inputs;
    let (request, auth_context_id) = request.into_parts();
    let storage = params.storage;
    let send_options = runtime_config.send_options();
    let resolved_settings = &runtime_config.settings;
    let cookie_behavior = CookieBehavior {
        store: cookie_store,
        send_cookies: resolved_settings.send_cookies.value,
        store_cookies: resolved_settings.store_cookies.value,
    };

    let rendered_request = render_http_request(
        &request,
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

    let request_content_length = match sendable_request.body.as_ref() {
        Some(SendableBody::Bytes(_)) => sendable_body_length(sendable_request.body.as_ref()),
        Some(SendableBody::Stream { .. }) | None => None,
    };
    let mut response = params.existing_response.unwrap_or_default();
    response.request_id = request.id.clone();
    response.workspace_id = request.workspace_id.clone();
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
    // Responses with no request behind them are ephemeral: they belong to whoever called this
    // function and never reach the model store.
    let store = storage.as_ref().filter(|_| !response.request_id.is_empty());
    let persist_response = store.is_some();
    if let Some(store) = store {
        response = store
            .query_manager
            .connect()
            .upsert_http_response(&response, &store.update_source, store.blob_manager)
            .map_err(SendHttpRequestError::PersistResponse)?;
    } else if response.id.is_empty() {
        response.id = generate_prefixed_id("rs");
    }

    let request_body_id = format!("{}.request", response.id);
    let mut request_body_capture_task = None;
    let mut request_body_capture_error = None;
    if let Some(store) = store {
        match sendable_request.body.as_mut() {
            Some(SendableBody::Bytes(bytes)) => {
                if let Err(err) =
                    persist_request_body_bytes(store.blob_manager, &request_body_id, bytes.as_ref())
                {
                    request_body_capture_error = Some(err);
                }
            }
            Some(SendableBody::Stream { data, .. }) => {
                let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
                let inner = std::mem::replace(data, Box::pin(tokio::io::empty()));
                let tee_reader = TeeReader::new(inner, tx);
                *data = Box::pin(tee_reader);
                let blob_manager = store.blob_manager.clone();
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
    let event_store = store.map(|store| (store.query_manager.clone(), store.update_source.clone()));
    let event_response_id = response.id.clone();
    let event_workspace_id = request.workspace_id.clone();
    let emit_events_to = params.emit_events_to.clone();
    let dns_elapsed = Arc::new(AtomicI32::new(0));
    let event_dns_elapsed = dns_elapsed.clone();
    let event_handle = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if let SenderHttpResponseEvent::DnsResolved { duration, .. } = &event {
                event_dns_elapsed.store(u64_to_i32(*duration), Ordering::Relaxed);
            }

            if let Some((query_manager, update_source)) = event_store.as_ref() {
                let db_event = HttpResponseEvent::new(
                    &event_response_id,
                    &event_workspace_id,
                    event.clone().into(),
                );
                if let Err(err) =
                    query_manager.connect().upsert_http_response_event(&db_event, update_source)
                {
                    warn!("Failed to persist HTTP response event: {}", err);
                }
            }

            if let Some(tx) = emit_events_to.as_ref() {
                let _ = tx.try_send(event);
            }
        }
    });

    let executor = params.executor;
    let started_at = Instant::now();
    let request_started_url = sendable_request.url.clone();

    for event in resolved_settings.timeline_events() {
        if let HttpResponseEventData::Setting {
            name,
            value,
            source_model,
            source_id,
            source_name,
        } = event
        {
            let _ = event_tx.try_send(SenderHttpResponseEvent::Setting {
                name,
                value,
                source_model,
                source_id,
                source_name,
            });
        }
    }

    let mut http_response =
        match executor.send(sendable_request, event_tx, cookie_behavior.clone()).await {
            Ok(response) => response,
            Err(err) => {
                if let Some(store) = store {
                    let _ = persist_response_error(
                        store,
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
    let body_path = match storage.as_ref() {
        Some(storage) => {
            std::fs::create_dir_all(storage.response_dir).map_err(|source| {
                SendHttpRequestError::CreateResponseDirectory {
                    path: storage.response_dir.to_path_buf(),
                    source,
                }
            })?;
            Some(storage.response_dir.join(&response.id))
        }
        None => None,
    };
    let response_body_path = body_path.as_ref().map(|p| p.to_string_lossy().to_string());
    let connected_response = HttpResponse {
        state: HttpResponseState::Connected,
        elapsed_headers: headers_elapsed,
        status: i32::from(http_response.status),
        status_reason: http_response.status_reason.clone(),
        url: http_response.url.clone(),
        remote_addr: http_response.remote_addr.clone(),
        version: http_response.version.clone(),
        elapsed_dns: dns_elapsed.load(Ordering::Relaxed),
        body_path: response_body_path.clone(),
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
    if let Some(store) = store {
        response = store
            .query_manager
            .connect()
            .upsert_http_response(&connected_response, &store.update_source, store.blob_manager)
            .map_err(SendHttpRequestError::PersistResponse)?;
    } else {
        response = connected_response;
    }

    let mut body_file = match body_path {
        Some(path) => {
            let file =
                File::options().create(true).truncate(true).write(true).open(&path).await.map_err(
                    |source| SendHttpRequestError::WriteResponseBody { path: path.clone(), source },
                )?;
            Some((file, path))
        }
        None => None,
    };
    let mut body_stream =
        http_response.into_body_stream().map_err(SendHttpRequestError::ReadResponseBody)?;
    let mut read_buf = vec![0; 64 * 1024];
    // Decided once, before the first chunk: the accumulator only exists in the
    // one arm that returns it, so nothing can hand back bytes it never received.
    let mut response_body = if params.emit_response_body_chunks_to.is_some() {
        ResponseBody::Streamed
    } else if persist_response {
        ResponseBody::Stored
    } else {
        ResponseBody::Returned(Vec::new())
    };
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
                result = body_stream.read(&mut read_buf) => {
                    Some(result)
                }
            }
        } else {
            Some(body_stream.read(&mut read_buf).await)
        };

        let Some(read_result) = read_result else {
            break;
        };

        match read_result {
            Ok(0) => break,
            Ok(n) => {
                written_bytes += n;
                let chunk = &read_buf[..n];
                if let Some((file, path)) = body_file.as_mut() {
                    file.write_all(chunk).await.map_err(|source| {
                        SendHttpRequestError::WriteResponseBody { path: path.clone(), source }
                    })?;
                }
                if let Some(tx) = params.emit_response_body_chunks_to.as_ref() {
                    let _ = tx.send(chunk.to_vec());
                } else if let ResponseBody::Returned(body) = &mut response_body {
                    body.extend_from_slice(chunk);
                }

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
                    if let Some(store) = store {
                        response = store
                            .query_manager
                            .connect()
                            .upsert_http_response(
                                &progress_response,
                                &store.update_source,
                                store.blob_manager,
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

    if let Some((file, path)) = body_file.as_mut() {
        file.flush().await.map_err(|source| SendHttpRequestError::WriteResponseBody {
            path: path.clone(),
            source,
        })?;
    }
    drop(body_stream);

    if let Some(err) = request_body_capture_error.take() {
        response.error = Some(append_error_message(
            response.error.take(),
            format!("Request succeeded but failed to store request body: {err}"),
        ));
    }

    if let Some(err) = body_read_error {
        if let Some(store) = store {
            let _ = persist_response_error(
                store,
                &response,
                started_at,
                err.to_string(),
                request_started_url,
            );
        }
        if let Some(task) = request_body_capture_task.take() {
            match task.await {
                Ok(Ok(_)) => {}
                Ok(Err(err)) => warn!("Failed to store request body after response error: {err}"),
                Err(err) => warn!("Failed to join request body capture task: {err}"),
            }
        }
        if let Err(join_err) = event_handle.await {
            warn!("Failed to join response event task: {}", join_err);
        }
        return Err(err);
    }

    let compressed_length = http_response.content_length.unwrap_or(written_bytes as u64);
    let final_response = HttpResponse {
        body_path: response_body_path,
        content_length: Some(usize_to_i32(written_bytes)),
        content_length_compressed: Some(u64_to_i32(compressed_length)),
        elapsed: duration_to_i32(started_at.elapsed()),
        elapsed_headers: headers_elapsed,
        elapsed_dns: dns_elapsed.load(Ordering::Relaxed),
        state: HttpResponseState::Closed,
        ..response
    };
    if let Some(store) = store {
        response = store
            .query_manager
            .connect()
            .upsert_http_response(&final_response, &store.update_source, store.blob_manager)
            .map_err(SendHttpRequestError::PersistResponse)?;
    } else {
        response = final_response;
    }

    // Request-body history can be much larger than the response. It should not keep the
    // response in a loading state after the network/response-body work has completed.
    if let Some(task) = request_body_capture_task.take() {
        let mut update_response = false;
        match task.await {
            Ok(Ok(total)) => {
                let total = Some(usize_to_i32(total));
                if response.request_content_length != total {
                    response.request_content_length = total;
                    update_response = true;
                }
            }
            Ok(Err(err)) => {
                response.error = Some(append_error_message(
                    response.error.take(),
                    format!("Request succeeded but failed to store request body: {err}"),
                ));
                update_response = true;
            }
            Err(err) => {
                response.error = Some(append_error_message(
                    response.error.take(),
                    format!("Request succeeded but failed to store request body: {err}"),
                ));
                update_response = true;
            }
        }

        if update_response && let Some(store) = store {
            response = store
                .query_manager
                .connect()
                .upsert_http_response(&response, &store.update_source, store.blob_manager)
                .map_err(SendHttpRequestError::PersistResponse)?;
        }
    }

    // Timeline events are useful history, but they should not keep the response in a loading state
    // after the network/response-body work has completed.
    if let Err(join_err) = event_handle.await {
        warn!("Failed to join response event task: {}", join_err);
    }

    Ok(SendHttpRequestResult {
        rendered_request,
        response,
        response_body,
        cookies: cookie_behavior.store.as_ref().map(|store| store.get_all_cookies()),
    })
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

    // Stream reads arrive in small (eg. 8-16 KiB) pieces, so accumulate them into
    // full-size chunks to avoid thousands of tiny inserts for large bodies
    let mut buf: Vec<u8> = Vec::with_capacity(REQUEST_BODY_CHUNK_SIZE);
    while let Some(data) = rx.recv().await {
        total_bytes += data.len();
        buf.extend_from_slice(&data);
        while buf.len() >= REQUEST_BODY_CHUNK_SIZE {
            let data = buf.drain(..REQUEST_BODY_CHUNK_SIZE).collect();
            let chunk = BodyChunk::new(&body_id, chunk_index, data);
            blob_manager.connect().insert_chunk(&chunk).map_err(|e| e.to_string())?;
            chunk_index += 1;
        }
    }

    if !buf.is_empty() {
        let chunk = BodyChunk::new(&body_id, chunk_index, buf);
        blob_manager.connect().insert_chunk(&chunk).map_err(|e| e.to_string())?;
    }

    Ok(total_bytes)
}

fn append_error_message(existing_error: Option<String>, message: String) -> String {
    match existing_error {
        Some(existing) => format!("{existing}; {message}"),
        None => message,
    }
}

pub fn load_cookie_jar(
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

/// Write the cookies a send collected back to its jar.
///
/// The store is shared with the HTTP transaction, so it holds every cookie picked up along the
/// way no matter how the send ended — including when the response arrived but the storage work
/// after it failed. Call this whatever the send returned; a send that failed before the
/// transaction started leaves the store untouched, which compares equal and writes nothing.
pub fn persist_cookies_after_send(
    query_manager: &QueryManager,
    cookie_jar: Option<&mut CookieJar>,
    cookie_store: Option<&CookieStore>,
) -> Result<()> {
    let (Some(cookie_jar), Some(cookie_store)) = (cookie_jar, cookie_store) else {
        return Ok(());
    };

    let cookies = cookie_store.get_all_cookies();
    if cookies == cookie_jar.cookies {
        return Ok(());
    }

    cookie_jar.cookies = cookies;
    query_manager
        .connect()
        .upsert_cookie_jar(cookie_jar, &UpdateSource::Background)
        .map_err(SendHttpRequestError::PersistCookieJar)?;
    Ok(())
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
                body: match &sendable_request.body {
                    // Bodies above the cap are not passed to auth plugins. Copying
                    // them across the plugin IPC is too expensive, and payloads that
                    // large are usually uploads that signing schemes treat as
                    // unsigned anyway. Streamed bodies (files, multipart) are never
                    // passed for the same reason.
                    Some(SendableBody::Bytes(bytes)) if bytes.len() <= MAX_AUTH_BODY_BYTES => {
                        String::from_utf8(bytes.to_vec()).ok()
                    }
                    _ => None,
                },
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
    store: &ResponseStorage,
    response: &HttpResponse,
    started_at: Instant,
    error: String,
    fallback_url: String,
) -> Result<HttpResponse> {
    let elapsed = duration_to_i32(started_at.elapsed());
    store
        .query_manager
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
            &store.update_source,
            store.blob_manager,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::pin::Pin;
    use tempfile::TempDir;
    use tokio::io::AsyncRead;
    use yaak_http::decompress::ContentEncoding;
    use yaak_models::models::{CookieDomain, CookieExpires, Workspace};

    struct NoopTemplateCallback;

    impl TemplateCallback for NoopTemplateCallback {
        async fn run(
            &self,
            _fn_name: &str,
            _args: HashMap<String, serde_json::Value>,
        ) -> yaak_templates::error::Result<String> {
            Ok(String::new())
        }

        fn transform_arg(
            &self,
            _fn_name: &str,
            _arg_name: &str,
            arg_value: &str,
        ) -> yaak_templates::error::Result<String> {
            Ok(arg_value.to_string())
        }
    }

    struct StubExecutor {
        body: &'static [u8],
    }

    #[async_trait]
    impl SendRequestExecutor for StubExecutor {
        async fn send(
            &self,
            sendable_request: SendableHttpRequest,
            event_tx: mpsc::Sender<SenderHttpResponseEvent>,
            _cookie_behavior: CookieBehavior,
        ) -> yaak_http::error::Result<yaak_http::sender::HttpResponse> {
            let _ = event_tx.try_send(SenderHttpResponseEvent::HeaderDown(
                "content-type".to_string(),
                "text/plain".to_string(),
            ));
            let body: Pin<Box<dyn AsyncRead + Send>> =
                Box::pin(std::io::Cursor::new(self.body.to_vec()));
            Ok(yaak_http::sender::HttpResponse::new(
                200,
                Some("OK".to_string()),
                vec![("content-type".to_string(), "text/plain".to_string())],
                Vec::new(),
                Some(self.body.len() as u64),
                sendable_request.url.clone(),
                None,
                Some("HTTP/1.1".to_string()),
                body,
                ContentEncoding::Identity,
            ))
        }
    }

    /// The hosted sender runs with no query manager, blob manager, or response directory. Nothing
    /// here touches storage, so the caller's only view of the response is what gets streamed out.
    #[tokio::test]
    async fn sends_without_a_database() {
        let (event_tx, mut event_rx) = mpsc::channel(HTTP_EVENT_CHANNEL_CAPACITY);
        let (chunk_tx, mut chunk_rx) = mpsc::unbounded_channel();
        let executor = StubExecutor { body: b"hello world" };

        let result = send_http_request(SendHttpRequestParams {
            inputs: HttpSendInputs {
                request: ResolvedHttpRequest::assume_resolved(
                    HttpRequest {
                        workspace_id: "wk_test".to_string(),
                        url: "http://localhost/test".to_string(),
                        ..Default::default()
                    },
                    String::new(),
                ),
                environment_chain: Vec::new(),
                runtime_config: HttpSendRuntimeConfig {
                    settings: ResolvedHttpRequestSettings::default(),
                    proxy: HttpConnectionProxySetting::System,
                    dns_overrides: Vec::new(),
                    client_certificates: Vec::new(),
                },
                cookie_store: Some(CookieStore::new()),
            },
            template_callback: &NoopTemplateCallback,
            storage: None,
            emit_events_to: Some(event_tx),
            emit_response_body_chunks_to: Some(chunk_tx),
            cancelled_rx: None,
            existing_response: None,
            prepare_sendable_request: None,
            executor: &executor,
        })
        .await
        .expect("send should succeed without a database");

        assert_eq!(result.response.status, 200);
        assert!(matches!(result.response.state, HttpResponseState::Closed));
        assert_eq!(result.response.content_length, Some(11));
        assert!(result.cookies.is_some());

        // Nothing was written, so the response carries no body file and only ever lived in memory.
        assert_eq!(result.response.body_path, None);
        assert!(!result.response.id.is_empty());

        let mut body = Vec::new();
        while let Some(chunk) = chunk_rx.recv().await {
            body.extend_from_slice(&chunk);
        }
        assert_eq!(body, b"hello world");

        let mut events = Vec::new();
        while let Some(event) = event_rx.recv().await {
            events.push(event);
        }
        assert!(
            events.iter().any(
                |e| matches!(e, SenderHttpResponseEvent::Setting { name, .. } if name == "redirects")
            ),
            "expected timeline settings events, got {events:?}"
        );
        assert!(
            events.iter().any(|e| matches!(e, SenderHttpResponseEvent::HeaderDown(..))),
            "expected timeline events from the executor, got {events:?}"
        );
    }

    /// A response nothing stores has to hand its body back, because no later
    /// read can find it: there is no row to look up and no id to read it by.
    /// GraphQL introspection is the caller that depends on this.
    #[tokio::test]
    async fn returns_the_body_when_nothing_stores_it() {
        let executor = StubExecutor { body: b"hello world" };

        let result = send_http_request(SendHttpRequestParams {
            inputs: HttpSendInputs {
                request: ResolvedHttpRequest::assume_resolved(
                    HttpRequest {
                        workspace_id: "wk_test".to_string(),
                        url: "http://localhost/test".to_string(),
                        ..Default::default()
                    },
                    String::new(),
                ),
                environment_chain: Vec::new(),
                runtime_config: HttpSendRuntimeConfig {
                    settings: ResolvedHttpRequestSettings::default(),
                    proxy: HttpConnectionProxySetting::System,
                    dns_overrides: Vec::new(),
                    client_certificates: Vec::new(),
                },
                cookie_store: Some(CookieStore::new()),
            },
            template_callback: &NoopTemplateCallback,
            storage: None,
            emit_events_to: None,
            // No chunk sender: the body is collected for the caller instead.
            emit_response_body_chunks_to: None,
            cancelled_rx: None,
            existing_response: None,
            prepare_sendable_request: None,
            executor: &executor,
        })
        .await
        .expect("send should succeed without a database");

        let ResponseBody::Returned(body) = result.response_body else {
            panic!("a response nothing stores has to hand its body back");
        };
        assert_eq!(body, b"hello world");
        assert!(result.response.request_id.is_empty(), "an unsaved response has no request");
    }

    fn seed_cookie_jar() -> (QueryManager, CookieJar, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let (query_manager, _blob_manager, _rx) = yaak_models::init_standalone(
            &temp_dir.path().join("db.sqlite"),
            &temp_dir.path().join("blobs.sqlite"),
        )
        .expect("Failed to initialize DB");

        query_manager
            .connect()
            .upsert_workspace(
                &Workspace { id: "wk_test".to_string(), ..Default::default() },
                &UpdateSource::Sync,
            )
            .expect("Failed to seed workspace");
        let cookie_jar = query_manager
            .connect()
            .upsert_cookie_jar(
                &CookieJar {
                    id: "cj_test".to_string(),
                    workspace_id: "wk_test".to_string(),
                    name: "Default".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )
            .expect("Failed to seed cookie jar");

        (query_manager, cookie_jar, temp_dir)
    }

    fn cookie(name: &str) -> Cookie {
        Cookie {
            name: name.to_string(),
            value: "value".to_string(),
            domain: CookieDomain::HostOnly("localhost".to_string()),
            expires: CookieExpires::SessionEnd,
            path: "/".to_string(),
            secure: false,
            http_only: false,
            same_site: None,
        }
    }

    /// Cookies the transaction collected must survive no matter how the send ended, including the
    /// storage work that runs after a response has already arrived.
    #[test]
    fn persists_cookies_collected_before_a_failure() {
        let (query_manager, mut cookie_jar, _temp_dir) = seed_cookie_jar();
        let store = CookieStore::from_cookies(cookie_jar.cookies.clone());
        store.store_cookies_from_response(
            &"http://localhost/test".parse().expect("valid url"),
            &["session=abc123; Path=/".to_string()],
        );

        persist_cookies_after_send(&query_manager, Some(&mut cookie_jar), Some(&store))
            .expect("Failed to persist cookies");

        let stored =
            query_manager.connect().get_cookie_jar("cj_test").expect("Failed to load cookie jar");
        assert_eq!(stored.cookies.len(), 1);
        assert_eq!(stored.cookies[0].name, "session");
        assert_eq!(stored.cookies[0].value, "abc123");
    }

    /// A send that failed before the transaction started leaves the store untouched, so there is
    /// nothing to write and a concurrent update to the jar must not be clobbered.
    #[test]
    fn leaves_the_jar_alone_when_no_cookies_changed() {
        let (query_manager, mut cookie_jar, _temp_dir) = seed_cookie_jar();
        cookie_jar.cookies = vec![cookie("original")];
        cookie_jar = query_manager
            .connect()
            .upsert_cookie_jar(&cookie_jar, &UpdateSource::Sync)
            .expect("Failed to seed cookies");
        let store = CookieStore::from_cookies(cookie_jar.cookies.clone());

        // Someone else updates the jar while the send is in flight.
        query_manager
            .connect()
            .upsert_cookie_jar(
                &CookieJar { cookies: vec![cookie("newer")], ..cookie_jar.clone() },
                &UpdateSource::Sync,
            )
            .expect("Failed to update cookie jar");

        persist_cookies_after_send(&query_manager, Some(&mut cookie_jar), Some(&store))
            .expect("Failed to persist cookies");

        let stored =
            query_manager.connect().get_cookie_jar("cj_test").expect("Failed to load cookie jar");
        assert_eq!(stored.cookies, vec![cookie("newer")]);
    }
}
