use crate::render::render_http_request;
use log::warn;
use std::path::{Path, PathBuf};
use std::time::Instant;
use thiserror::Error;
use tokio::sync::mpsc;
use yaak_http::sender::{HttpResponseEvent as SenderHttpResponseEvent, HttpSender, ReqwestSender};
use yaak_http::types::{SendableBody, SendableHttpRequest, SendableHttpRequestOptions};
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{HttpResponse, HttpResponseEvent, HttpResponseHeader, HttpResponseState};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
use yaak_templates::{RenderOptions, TemplateCallback};

const HTTP_EVENT_CHANNEL_CAPACITY: usize = 100;

#[derive(Debug, Error)]
pub enum SendHttpRequestError {
    #[error("Failed to load request: {0}")]
    LoadRequest(#[source] yaak_models::error::Error),

    #[error("Failed to resolve environments: {0}")]
    ResolveEnvironments(#[source] yaak_models::error::Error),

    #[error("Failed to resolve inherited request settings: {0}")]
    ResolveRequestInheritance(#[source] yaak_models::error::Error),

    #[error("Failed to render request templates: {0}")]
    RenderRequest(#[source] yaak_templates::error::Error),

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

pub struct SendHttpRequestByIdParams<'a, T: TemplateCallback> {
    pub query_manager: &'a QueryManager,
    pub blob_manager: &'a BlobManager,
    pub request_id: &'a str,
    pub environment_id: Option<&'a str>,
    pub template_callback: &'a T,
    pub send_options: SendableHttpRequestOptions,
    pub update_source: UpdateSource,
    pub response_dir: &'a Path,
    pub persist_events: bool,
    pub emit_events_to: Option<mpsc::Sender<SenderHttpResponseEvent>>,
}

pub struct SendHttpRequestResult {
    pub rendered_request: yaak_models::models::HttpRequest,
    pub response: HttpResponse,
    pub response_body: Vec<u8>,
}

pub async fn send_http_request_by_id<T: TemplateCallback>(
    params: SendHttpRequestByIdParams<'_, T>,
) -> Result<SendHttpRequestResult> {
    let db = params.query_manager.connect();
    let request =
        db.get_http_request(params.request_id).map_err(SendHttpRequestError::LoadRequest)?;
    let environment_chain = db
        .resolve_environments(
            &request.workspace_id,
            request.folder_id.as_deref(),
            params.environment_id,
        )
        .map_err(SendHttpRequestError::ResolveEnvironments)?;

    let (authentication_type, authentication, _auth_context_id) = db
        .resolve_auth_for_http_request(&request)
        .map_err(SendHttpRequestError::ResolveRequestInheritance)?;
    let resolved_headers = db
        .resolve_headers_for_http_request(&request)
        .map_err(SendHttpRequestError::ResolveRequestInheritance)?;
    drop(db);

    let mut resolved_request = request.clone();
    resolved_request.authentication_type = authentication_type;
    resolved_request.authentication = authentication;
    resolved_request.headers = resolved_headers;

    let rendered_request = render_http_request(
        &resolved_request,
        environment_chain,
        params.template_callback,
        &RenderOptions::throw(),
    )
    .await
    .map_err(SendHttpRequestError::RenderRequest)?;

    let sendable_request =
        SendableHttpRequest::from_http_request(&rendered_request, params.send_options)
            .await
            .map_err(SendHttpRequestError::BuildSendableRequest)?;
    let request_content_length = sendable_body_length(sendable_request.body.as_ref());

    let mut response = params
        .query_manager
        .connect()
        .upsert_http_response(
            &HttpResponse {
                request_id: request.id.clone(),
                workspace_id: request.workspace_id.clone(),
                request_content_length,
                request_headers: sendable_request
                    .headers
                    .iter()
                    .map(|(name, value)| HttpResponseHeader {
                        name: name.clone(),
                        value: value.clone(),
                    })
                    .collect(),
                url: sendable_request.url.clone(),
                ..Default::default()
            },
            &params.update_source,
            params.blob_manager,
        )
        .map_err(SendHttpRequestError::PersistResponse)?;

    let (event_tx, mut event_rx) =
        mpsc::channel::<SenderHttpResponseEvent>(HTTP_EVENT_CHANNEL_CAPACITY);
    let event_query_manager = params.query_manager.clone();
    let event_response_id = response.id.clone();
    let event_workspace_id = request.workspace_id.clone();
    let event_update_source = params.update_source.clone();
    let emit_events_to = params.emit_events_to.clone();
    let persist_events = params.persist_events;
    let event_handle = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if persist_events {
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

    let sender = ReqwestSender::new().map_err(SendHttpRequestError::CreateHttpClient)?;
    let started_at = Instant::now();
    let request_started_url = sendable_request.url.clone();

    let http_response = match sender.send(sendable_request, event_tx).await {
        Ok(response) => response,
        Err(err) => {
            let _ = params
                .query_manager
                .connect()
                .upsert_http_response(
                    &HttpResponse {
                        state: HttpResponseState::Closed,
                        elapsed: duration_to_i32(started_at.elapsed()),
                        elapsed_headers: duration_to_i32(started_at.elapsed()),
                        error: Some(err.to_string()),
                        url: request_started_url,
                        ..response
                    },
                    &params.update_source,
                    params.blob_manager,
                )
                .map_err(SendHttpRequestError::PersistResponse)?;

            if let Err(join_err) = event_handle.await {
                warn!("Failed to join response event task: {}", join_err);
            }

            return Err(SendHttpRequestError::SendRequest(err));
        }
    };

    let headers_elapsed = duration_to_i32(started_at.elapsed());
    response = params
        .query_manager
        .connect()
        .upsert_http_response(
            &HttpResponse {
                state: HttpResponseState::Connected,
                elapsed_headers: headers_elapsed,
                status: i32::from(http_response.status),
                status_reason: http_response.status_reason.clone(),
                url: http_response.url.clone(),
                remote_addr: http_response.remote_addr.clone(),
                version: http_response.version.clone(),
                headers: http_response
                    .headers
                    .iter()
                    .map(|(name, value)| HttpResponseHeader {
                        name: name.clone(),
                        value: value.clone(),
                    })
                    .collect(),
                request_headers: http_response
                    .request_headers
                    .iter()
                    .map(|(name, value)| HttpResponseHeader {
                        name: name.clone(),
                        value: value.clone(),
                    })
                    .collect(),
                ..response
            },
            &params.update_source,
            params.blob_manager,
        )
        .map_err(SendHttpRequestError::PersistResponse)?;

    let (response_body, body_stats) =
        http_response.bytes().await.map_err(SendHttpRequestError::ReadResponseBody)?;

    std::fs::create_dir_all(params.response_dir).map_err(|source| {
        SendHttpRequestError::CreateResponseDirectory {
            path: params.response_dir.to_path_buf(),
            source,
        }
    })?;

    let body_path = params.response_dir.join(&response.id);
    std::fs::write(&body_path, &response_body).map_err(|source| {
        SendHttpRequestError::WriteResponseBody { path: body_path.clone(), source }
    })?;

    response = params
        .query_manager
        .connect()
        .upsert_http_response(
            &HttpResponse {
                body_path: Some(body_path.to_string_lossy().to_string()),
                content_length: Some(usize_to_i32(response_body.len())),
                content_length_compressed: Some(u64_to_i32(body_stats.size_compressed)),
                elapsed: duration_to_i32(started_at.elapsed()),
                elapsed_headers: headers_elapsed,
                state: HttpResponseState::Closed,
                ..response
            },
            &params.update_source,
            params.blob_manager,
        )
        .map_err(SendHttpRequestError::PersistResponse)?;

    if let Err(join_err) = event_handle.await {
        warn!("Failed to join response event task: {}", join_err);
    }

    Ok(SendHttpRequestResult { rendered_request, response, response_body })
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
