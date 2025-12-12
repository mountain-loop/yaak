use crate::error::Error::GenericError;
use crate::error::Result;
use crate::render::render_http_request;
use crate::response_err;
use http::{HeaderName, HeaderValue};
use log::{debug, error, warn};
use reqwest::{Method, Response, Url};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, Runtime, WebviewWindow};
use tokio::fs::{create_dir_all, File};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch::Receiver;
use tokio::sync::{oneshot, Mutex};
use yaak_http::client::{
    HttpConnectionOptions, HttpConnectionProxySetting, HttpConnectionProxySettingAuth,
};
use yaak_http::manager::HttpConnectionManager;
use tokio_util::codec::{BytesCodec, FramedRead};
use yaak_http::types::{SendableBody, SendableHttpRequest};
use yaak_models::models::{
    Cookie, CookieJar, Environment, HttpRequest, HttpResponse, HttpResponseHeader,
    HttpResponseState, ProxySetting, ProxySettingAuth,
};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    CallHttpAuthenticationRequest, HttpHeader, PluginContext, RenderPurpose,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderErrorBehavior, RenderOptions};
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
    cancelled_rx: &mut Receiver<bool>,
    plugin_context: &PluginContext,
) -> Result<HttpResponse> {
    let app_handle = window.app_handle().clone();
    let plugin_manager = app_handle.state::<PluginManager>();
    let connection_manager = app_handle.state::<HttpConnectionManager>();
    let settings = window.db().get_settings();
    let workspace = window.db().get_workspace(&unrendered_request.workspace_id)?;
    let environment_id = environment.map(|e| e.id);
    let environment_chain = window.db().resolve_environments(
        &unrendered_request.workspace_id,
        unrendered_request.folder_id.as_deref(),
        environment_id.as_deref(),
    )?;

    let response_id = og_response.id.clone();
    let response = Arc::new(Mutex::new(og_response.clone()));

    let update_source = UpdateSource::from_window(window);

    let (resolved_request, auth_context_id) = match resolve_http_request(window, unrendered_request)
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(response_err(
                &app_handle,
                &*response.lock().await,
                e.to_string(),
                &update_source,
            ));
        }
    };

    let cb = PluginTemplateCallback::new(window.app_handle(), &plugin_context, RenderPurpose::Send);

    let opt = RenderOptions {
        error_behavior: RenderErrorBehavior::Throw,
    };

    let request = match render_http_request(&resolved_request, environment_chain, &cb, &opt).await {
        Ok(r) => r,
        Err(e) => {
            return Ok(response_err(
                &app_handle,
                &*response.lock().await,
                e.to_string(),
                &update_source,
            ));
        }
    };

    // Build the sendable request using the new SendableHttpRequest type
    let sendable_request = match SendableHttpRequest::from_http_request(&request).await {
        Ok(r) => r,
        Err(e) => {
            return Ok(response_err(
                &app_handle,
                &*response.lock().await,
                e.to_string(),
                &update_source,
            ));
        }
    };

    debug!("Sending request to {} {}", sendable_request.method, sendable_request.url);

    let proxy_setting = match settings.proxy {
        None => HttpConnectionProxySetting::System,
        Some(ProxySetting::Disabled) => HttpConnectionProxySetting::Disabled,
        Some(ProxySetting::Enabled {
            http,
            https,
            auth,
            bypass,
            disabled,
        }) => {
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

    let client_certificate = find_client_certificate(&sendable_request.url, &settings.client_certificates);

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
            follow_redirects: workspace.setting_follow_redirects,
            validate_certificates: workspace.setting_validate_certificates,
            proxy: proxy_setting,
            cookie_provider: maybe_cookie_manager.as_ref().map(|(p, _)| Arc::clone(&p)),
            client_certificate,
            timeout: if workspace.setting_request_timeout > 0 {
                Some(Duration::from_millis(workspace.setting_request_timeout.unsigned_abs() as u64))
            } else {
                None
            },
        })
        .await?;

    // Build reqwest request from SendableHttpRequest
    let url = match Url::from_str(&sendable_request.url) {
        Ok(u) => u,
        Err(e) => {
            return Ok(response_err(
                &app_handle,
                &*response.lock().await,
                format!("Failed to parse URL \"{}\": {}", sendable_request.url, e.to_string()),
                &update_source,
            ));
        }
    };

    let m = Method::from_str(&sendable_request.method)
        .map_err(|e| GenericError(e.to_string()))?;
    let mut request_builder = client.request(m, url);

    // Add headers from SendableHttpRequest
    for h in &sendable_request.headers {
        let header_name = match HeaderName::from_str(&h.name) {
            Ok(n) => n,
            Err(e) => {
                error!("Failed to create header name {}: {}", h.name, e);
                continue;
            }
        };
        let header_value = match HeaderValue::from_str(&h.value) {
            Ok(n) => n,
            Err(e) => {
                error!("Failed to create header value {}: {}", h.value, e);
                continue;
            }
        };
        request_builder = request_builder.header(header_name, header_value);
    }

    // Add body if present
    if let Some(body) = sendable_request.body {
        match body {
            SendableBody::Bytes(bytes) => {
                request_builder = request_builder.body(bytes);
            }
            SendableBody::Stream(reader) => {
                let stream = FramedRead::new(reader, BytesCodec::new());
                request_builder = request_builder.body(reqwest::Body::wrap_stream(stream));
            }
        }
    }

    let mut sendable_req = match request_builder.build() {
        Ok(r) => r,
        Err(e) => {
            warn!("Failed to build request builder {e:?}");
            return Ok(response_err(
                &app_handle,
                &*response.lock().await,
                e.to_string(),
                &update_source,
            ));
        }
    };

    match request.authentication_type {
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
                url: sendable_req.url().to_string(),
                method: sendable_req.method().to_string(),
                headers: sendable_req
                    .headers()
                    .iter()
                    .map(|(name, value)| HttpHeader {
                        name: name.to_string(),
                        value: value.to_str().unwrap_or_default().to_string(),
                    })
                    .collect(),
            };
            let auth_result = plugin_manager
                .call_http_authentication(&window, &authentication_type, req, plugin_context)
                .await;
            let plugin_result = match auth_result {
                Ok(r) => r,
                Err(e) => {
                    return Ok(response_err(
                        &app_handle,
                        &*response.lock().await,
                        e.to_string(),
                        &update_source,
                    ));
                }
            };

            let headers = sendable_req.headers_mut();
            for header in plugin_result.set_headers.unwrap_or_default() {
                match (HeaderName::from_str(&header.name), HeaderValue::from_str(&header.value)) {
                    (Ok(name), Ok(value)) => {
                        headers.insert(name, value);
                    }
                    _ => continue,
                };
            }

            if let Some(params) = plugin_result.set_query_parameters {
                let mut query_pairs = sendable_req.url_mut().query_pairs_mut();
                for p in params {
                    query_pairs.append_pair(&p.name, &p.value);
                }
            }
        }
    }

    let (resp_tx, resp_rx) = oneshot::channel::<std::result::Result<Response, reqwest::Error>>();
    let (done_tx, done_rx) = oneshot::channel::<HttpResponse>();

    let start = std::time::Instant::now();

    tokio::spawn(async move {
        let _ = resp_tx.send(client.execute(sendable_req).await);
    });

    let raw_response = tokio::select! {
        Ok(r) = resp_rx => r,
        _ = cancelled_rx.changed() => {
            let mut r = response.lock().await;
            r.elapsed_headers = start.elapsed().as_millis() as i32;
            r.elapsed = start.elapsed().as_millis() as i32;
            return Ok(response_err(&app_handle, &r, "Request was cancelled".to_string(), &update_source));
        }
    };

    {
        let app_handle = app_handle.clone();
        let window = window.clone();
        let cancelled_rx = cancelled_rx.clone();
        let response_id = response_id.clone();
        let response = response.clone();
        let update_source = update_source.clone();
        tokio::spawn(async move {
            match raw_response {
                Ok(mut v) => {
                    let content_length = v.content_length();
                    let response_headers = v.headers().clone();
                    let dir = app_handle.path().app_data_dir().unwrap();
                    let base_dir = dir.join("responses");
                    create_dir_all(base_dir.clone()).await.expect("Failed to create responses dir");
                    let body_path = if response_id.is_empty() {
                        base_dir.join(uuid::Uuid::new_v4().to_string())
                    } else {
                        base_dir.join(response_id.clone())
                    };

                    {
                        let mut r = response.lock().await;
                        r.body_path = Some(body_path.to_str().unwrap().to_string());
                        r.elapsed_headers = start.elapsed().as_millis() as i32;
                        r.elapsed = start.elapsed().as_millis() as i32;
                        r.status = v.status().as_u16() as i32;
                        r.status_reason = v.status().canonical_reason().map(|s| s.to_string());
                        r.headers = response_headers
                            .iter()
                            .map(|(k, v)| HttpResponseHeader {
                                name: k.as_str().to_string(),
                                value: v.to_str().unwrap_or_default().to_string(),
                            })
                            .collect();
                        r.url = v.url().to_string();
                        r.remote_addr = v.remote_addr().map(|a| a.to_string());
                        r.version = match v.version() {
                            reqwest::Version::HTTP_09 => Some("HTTP/0.9".to_string()),
                            reqwest::Version::HTTP_10 => Some("HTTP/1.0".to_string()),
                            reqwest::Version::HTTP_11 => Some("HTTP/1.1".to_string()),
                            reqwest::Version::HTTP_2 => Some("HTTP/2".to_string()),
                            reqwest::Version::HTTP_3 => Some("HTTP/3".to_string()),
                            _ => None,
                        };

                        r.state = HttpResponseState::Connected;
                        app_handle
                            .db()
                            .update_http_response_if_id(&r, &update_source)
                            .expect("Failed to update response after connected");
                    }

                    // Write body to FS
                    let mut f = File::options()
                        .create(true)
                        .truncate(true)
                        .write(true)
                        .open(&body_path)
                        .await
                        .expect("Failed to open file");

                    let mut written_bytes: usize = 0;
                    loop {
                        let chunk = v.chunk().await;
                        if *cancelled_rx.borrow() {
                            // Request was canceled
                            return;
                        }
                        match chunk {
                            Ok(Some(bytes)) => {
                                let mut r = response.lock().await;
                                r.elapsed = start.elapsed().as_millis() as i32;
                                f.write_all(&bytes).await.expect("Failed to write to file");
                                f.flush().await.expect("Failed to flush file");
                                written_bytes += bytes.len();
                                r.content_length = Some(written_bytes as i32);
                                app_handle
                                    .db()
                                    .update_http_response_if_id(&r, &update_source)
                                    .expect("Failed to update response");
                            }
                            Ok(None) => {
                                break;
                            }
                            Err(e) => {
                                response_err(
                                    &app_handle,
                                    &*response.lock().await,
                                    e.to_string(),
                                    &update_source,
                                );
                                break;
                            }
                        }
                    }

                    // Set the final content length
                    {
                        let mut r = response.lock().await;
                        r.content_length = match content_length {
                            Some(l) => Some(l as i32),
                            None => Some(written_bytes as i32),
                        };
                        r.state = HttpResponseState::Closed;
                        app_handle
                            .db()
                            .update_http_response_if_id(&r, &UpdateSource::from_window(&window))
                            .expect("Failed to update response");
                    };

                    // Add cookie store if specified
                    if let Some((cookie_store, mut cookie_jar)) = maybe_cookie_manager {
                        // let cookies = response_headers.get_all(SET_COOKIE).iter().map(|h| {
                        //     println!("RESPONSE COOKIE: {}", h.to_str().unwrap());
                        //     cookie_store::RawCookie::from_str(h.to_str().unwrap())
                        //         .expect("Failed to parse cookie")
                        // });
                        // store.store_response_cookies(cookies, &url);

                        let json_cookies: Vec<Cookie> = cookie_store
                            .lock()
                            .unwrap()
                            .iter_any()
                            .map(|c| {
                                let json_cookie =
                                    serde_json::to_value(&c).expect("Failed to serialize cookie");
                                serde_json::from_value(json_cookie)
                                    .expect("Failed to deserialize cookie")
                            })
                            .collect::<Vec<_>>();
                        cookie_jar.cookies = json_cookies;
                        if let Err(e) = app_handle
                            .db()
                            .upsert_cookie_jar(&cookie_jar, &UpdateSource::from_window(&window))
                        {
                            error!("Failed to update cookie jar: {}", e);
                        };
                    }
                }
                Err(e) => {
                    warn!("Failed to execute request {e}");
                    response_err(
                        &app_handle,
                        &*response.lock().await,
                        format!("{e} → {e:?}"),
                        &update_source,
                    );
                }
            };

            let r = response.lock().await.clone();
            done_tx.send(r).unwrap();
        });
    };

    let app_handle = app_handle.clone();
    Ok(tokio::select! {
        Ok(r) = done_rx => r,
        _ = cancelled_rx.changed() => {
            match app_handle.with_db(|c| c.get_http_response(&response_id)) {
                Ok(mut r) => {
                    r.state = HttpResponseState::Closed;
                    r.elapsed = start.elapsed().as_millis() as i32;
                    r.elapsed_headers = start.elapsed().as_millis() as i32;
                    app_handle.db().update_http_response_if_id(&r, &UpdateSource::from_window(window))
                        .expect("Failed to update response")
                },
                _ => {
                    response_err(&app_handle, &*response.lock().await, "Ephemeral request was cancelled".to_string(), &update_source)
                }.clone(),
            }
        }
    })
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
