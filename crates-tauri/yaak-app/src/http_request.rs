use crate::PluginContextExt;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::models_ext::BlobManagerExt;
use crate::models_ext::QueryManagerExt;
use log::warn;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::sync::watch::Receiver;
use yaak::send::{SendHttpRequestWithPluginsParams, send_http_request_with_plugins};
use yaak_crypto::manager::EncryptionManager;
use yaak_http::manager::HttpConnectionManager;
use yaak_models::models::{CookieJar, Environment, HttpRequest, HttpResponse, HttpResponseState};
use yaak_models::util::UpdateSource;
use yaak_plugins::events::PluginContext;
use yaak_plugins::manager::PluginManager;

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
        &window.plugin_context(),
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
    let update_source = UpdateSource::from_window_label(window.label());
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
    let plugin_manager = Arc::new((*app_handle.state::<PluginManager>()).clone());
    let encryption_manager = Arc::new((*app_handle.state::<EncryptionManager>()).clone());
    let connection_manager = app_handle.state::<HttpConnectionManager>();
    let environment_id = environment.map(|e| e.id);
    let cookie_jar_id = cookie_jar.as_ref().map(|jar| jar.id.clone());

    let response_dir = app_handle.path().app_data_dir()?.join("responses");
    let result = send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
        query_manager: app_handle.db_manager().inner(),
        blob_manager: app_handle.blob_manager().inner(),
        request: unrendered_request.clone(),
        environment_id: environment_id.as_deref(),
        update_source: response_ctx.update_source.clone(),
        cookie_jar_id,
        response_dir: &response_dir,
        emit_events_to: None,
        existing_response: Some(response_ctx.response().clone()),
        plugin_manager,
        encryption_manager,
        plugin_context,
        cancelled_rx: Some(cancelled_rx.clone()),
        connection_manager: Some(connection_manager.inner()),
    })
    .await
    .map_err(|e| GenericError(e.to_string()))?;

    Ok(result.response)
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
