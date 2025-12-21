use crate::error::Error::GenericError;
use crate::error::Result;
use crate::render::render_http_request;
use crate::response_err;
use log::debug;
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::fs::{File, create_dir_all};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio::sync::watch::Receiver;
use yaak_http::client::{
    HttpConnectionOptions, HttpConnectionProxySetting, HttpConnectionProxySettingAuth,
};
use yaak_http::manager::HttpConnectionManager;
use yaak_http::sender::ReqwestSender;
use yaak_http::transaction::HttpTransaction;
use yaak_http::types::{SendableHttpRequest, SendableHttpRequestOptions, append_query_params};
use yaak_models::models::{
    CookieJar, Environment, HttpRequest, HttpResponse, HttpResponseHeader, HttpResponseState,
    ProxySetting, ProxySettingAuth,
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
    let wrk_id = &unrendered_request.workspace_id;
    let fld_id = unrendered_request.folder_id.as_deref();
    let env_id = environment.map(|e| e.id);
    let resp_id = og_response.id.clone();
    let workspace = window.db().get_workspace(wrk_id)?;
    let response = Arc::new(Mutex::new(og_response.clone()));
    let update_source = UpdateSource::from_window(window);
    let (resolved, auth_context_id) = resolve_http_request(window, unrendered_request)?;
    let cb = PluginTemplateCallback::new(window.app_handle(), &plugin_context, RenderPurpose::Send);
    let env_chain = window.db().resolve_environments(&workspace.id, fld_id, env_id.as_deref())?;
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
        &resp_id,
        &app_handle,
        &update_source,
        cancelled_rx.clone(),
    )
    .await;

    match final_resp {
        Ok(r) => Ok(r),
        Err(e) => match app_handle.db().get_http_response(&resp_id) {
            Ok(mut r) => {
                r.state = HttpResponseState::Closed;
                r.elapsed = start_for_cancellation.elapsed().as_millis() as i32;
                r.elapsed_headers = start_for_cancellation.elapsed().as_millis() as i32;
                r.error = Some(e.to_string());
                app_handle
                    .db()
                    .update_http_response_if_id(&r, &UpdateSource::from_window(window))
                    .expect("Failed to update response");
                Ok(r)
            }
            _ => Err(GenericError("Ephemeral request was cancelled".to_string())),
        },
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
    sendable_request: SendableHttpRequest,
    response: Arc<Mutex<HttpResponse>>,
    response_id: &String,
    app_handle: &AppHandle<R>,
    update_source: &UpdateSource,
    cancelled_rx: Receiver<bool>,
) -> Result<HttpResponse> {
    let sender = ReqwestSender::with_client(client);
    let transaction = HttpTransaction::new(sender);
    let start = Instant::now();

    // Capture request headers before sending
    let request_headers: Vec<HttpResponseHeader> = sendable_request
        .headers
        .iter()
        .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
        .collect();

    {
        // Update response with headers info and mark as connected
        let mut r = response.lock().await;
        r.url = sendable_request.url.clone();
        r.request_headers = request_headers.clone();
        app_handle.db().update_http_response_if_id(&r, &update_source)?;
    }

    // Execute the transaction with cancellation support
    // This returns the response with headers, but body is not yet consumed
    let (mut http_response, _events) =
        transaction.execute_with_cancellation(sendable_request, cancelled_rx.clone()).await?;

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

    {
        // Update response with headers info and mark as connected
        let mut r = response.lock().await;
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
        app_handle.db().update_http_response_if_id(&r, &update_source)?;
    }

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

        match body_stream.read(&mut buf).await {
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
                let mut r = response.lock().await;
                r.elapsed = start.elapsed().as_millis() as i32; // Approx until the end
                r.content_length = Some(written_bytes as i32);
                app_handle.db().update_http_response_if_id(&r, &update_source)?;
            }
            Err(e) => {
                return Err(GenericError(format!("Failed to read response body: {}", e)));
            }
        }
    }

    // Final update with closed state
    let mut resp = response.lock().await.clone();
    resp.elapsed = start.elapsed().as_millis() as i32;
    resp.state = HttpResponseState::Closed;
    resp.body_path = Some(
        body_path.to_str().ok_or(GenericError(format!("Invalid path {body_path:?}",)))?.to_string(),
    );

    app_handle.db().update_http_response_if_id(&resp, &update_source)?;

    Ok(resp)
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
