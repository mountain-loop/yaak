use crate::error::Error::GenericError;
use crate::error::Result;
use crate::render::render_http_request;
use crate::response_err;
use http::header::{ACCEPT, USER_AGENT};
use http::{HeaderMap, HeaderName, HeaderValue};
use log::{debug, error, warn};
use mime_guess::Mime;
use reqwest::redirect::Policy;
use reqwest::{Method, NoProxy, Response};
use reqwest::{Proxy, Url, multipart};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, Runtime, WebviewWindow};
use tokio::fs;
use tokio::fs::{File, create_dir_all};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch::Receiver;
use tokio::sync::{Mutex, oneshot};
use yaak_models::models::{
    Cookie, CookieJar, Environment, HttpRequest, HttpResponse, HttpResponseHeader,
    HttpResponseState, ProxySetting, ProxySettingAuth,
};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    CallHttpAuthenticationRequest, HttpHeader, PluginWindowContext, RenderPurpose,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;

pub async fn send_http_request<R: Runtime>(
    window: &WebviewWindow<R>,
    unrendered_request: &HttpRequest,
    og_response: &HttpResponse,
    environment: Option<Environment>,
    cookie_jar: Option<CookieJar>,
    cancelled_rx: &mut Receiver<bool>,
) -> Result<HttpResponse> {
    let app_handle = window.app_handle().clone();
    let plugin_manager = app_handle.state::<PluginManager>();
    let (settings, workspace) = {
        let db = window.db();
        let settings = db.get_settings();
        let workspace = db.get_workspace(&unrendered_request.workspace_id)?;
        (settings, workspace)
    };
    let base_environment =
        app_handle.db().get_base_environment(&unrendered_request.workspace_id)?;

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

    let cb = PluginTemplateCallback::new(
        window.app_handle(),
        &PluginWindowContext::new(window),
        RenderPurpose::Send,
    );

    let request =
        match render_http_request(&resolved_request, &base_environment, environment.as_ref(), &cb)
            .await
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

    let mut url_string = request.url.clone();

    url_string = ensure_proto(&url_string);
    if !url_string.starts_with("http://") && !url_string.starts_with("https://") {
        url_string = format!("http://{}", url_string);
    }
    debug!("Sending request to {} {url_string}", request.method);

    let mut client_builder = reqwest::Client::builder()
        .redirect(match workspace.setting_follow_redirects {
            true => Policy::limited(10), // TODO: Handle redirects natively
            false => Policy::none(),
        })
        .connection_verbose(true)
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .referer(false)
        .tls_info(true);

    let tls_config = yaak_http::tls::get_config(workspace.setting_validate_certificates, true);
    client_builder = client_builder.use_preconfigured_tls(tls_config);

    match settings.proxy {
        Some(ProxySetting::Disabled) => client_builder = client_builder.no_proxy(),
        Some(ProxySetting::Enabled {
            http,
            https,
            auth,
            disabled,
            bypass,
        }) if !disabled => {
            debug!("Using proxy http={http} https={https} bypass={bypass}");
            if !http.is_empty() {
                match Proxy::http(http) {
                    Ok(mut proxy) => {
                        if let Some(ProxySettingAuth { user, password }) = auth.clone() {
                            debug!("Using http proxy auth");
                            proxy = proxy.basic_auth(user.as_str(), password.as_str());
                        }
                        proxy = proxy.no_proxy(NoProxy::from_string(&bypass));
                        client_builder = client_builder.proxy(proxy);
                    }
                    Err(e) => {
                        warn!("Failed to apply http proxy {e:?}");
                    }
                };
            }
            if !https.is_empty() {
                match Proxy::https(https) {
                    Ok(mut proxy) => {
                        if let Some(ProxySettingAuth { user, password }) = auth {
                            debug!("Using https proxy auth");
                            proxy = proxy.basic_auth(user.as_str(), password.as_str());
                        }
                        proxy = proxy.no_proxy(NoProxy::from_string(&bypass));
                        client_builder = client_builder.proxy(proxy);
                    }
                    Err(e) => {
                        warn!("Failed to apply https proxy {e:?}");
                    }
                };
            }
        }
        _ => {} // Nothing to do for this one, as it is the default
    }

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

            let store = reqwest_cookie_store::CookieStore::from_cookies(cookies, true)?;
            let cookie_store = reqwest_cookie_store::CookieStoreMutex::new(store);
            let cookie_store = Arc::new(cookie_store);
            client_builder = client_builder.cookie_provider(Arc::clone(&cookie_store));

            Some((cookie_store, cj))
        }
        None => None,
    };

    if workspace.setting_request_timeout > 0 {
        client_builder = client_builder.timeout(Duration::from_millis(
            workspace.setting_request_timeout.unsigned_abs() as u64,
        ));
    }

    let client = client_builder.build()?;

    // Render query parameters
    let mut query_params = Vec::new();
    for p in request.url_parameters.clone() {
        if !p.enabled || p.name.is_empty() {
            continue;
        }
        query_params.push((p.name, p.value));
    }

    let url = match Url::from_str(&url_string) {
        Ok(u) => u,
        Err(e) => {
            return Ok(response_err(
                &app_handle,
                &*response.lock().await,
                format!("Failed to parse URL \"{}\": {}", url_string, e.to_string()),
                &update_source,
            ));
        }
    };

    let m = Method::from_str(&request.method.to_uppercase())
        .map_err(|e| GenericError(e.to_string()))?;
    let mut request_builder = client.request(m, url).query(&query_params);

    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("yaak"));
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));

    // TODO: Set cookie header ourselves once we also handle redirects. We need to do this
    //  because reqwest doesn't give us a way to inspect the headers it sent (we have to do
    //  everything manually to know that).
    // if let Some(cookie_store) = maybe_cookie_store.clone() {
    //     let values1 = cookie_store.get_request_values(&url);
    //     let raw_value = cookie_store.get_request_values(&url)
    //         .map(|(name, value)| format!("{}={}", name, value))
    //         .collect::<Vec<_>>()
    //         .join("; ");
    //     headers.insert(
    //         COOKIE,
    //         HeaderValue::from_str(&raw_value).expect("Failed to create cookie header"),
    //     );
    // }

    for h in request.headers.clone() {
        if h.name.is_empty() && h.value.is_empty() {
            continue;
        }

        if !h.enabled {
            continue;
        }

        let header_name = match HeaderName::from_str(&h.name) {
            Ok(n) => n,
            Err(e) => {
                error!("Failed to create header name: {}", e);
                continue;
            }
        };
        let header_value = match HeaderValue::from_str(&h.value) {
            Ok(n) => n,
            Err(e) => {
                error!("Failed to create header value: {}", e);
                continue;
            }
        };

        headers.insert(header_name, header_value);
    }

    let request_body = request.body.clone();
    if let Some(body_type) = &request.body_type.clone() {
        if body_type == "graphql" {
            let query = get_str_h(&request_body, "query");
            let variables = get_str_h(&request_body, "variables");
            if request.method.to_lowercase() == "get" {
                request_builder = request_builder.query(&[("query", query)]);
                if !variables.trim().is_empty() {
                    request_builder = request_builder.query(&[("variables", variables)]);
                }
            } else {
                let body = if variables.trim().is_empty() {
                    format!(r#"{{"query":{}}}"#, serde_json::to_string(query).unwrap_or_default())
                } else {
                    format!(
                        r#"{{"query":{},"variables":{variables}}}"#,
                        serde_json::to_string(query).unwrap_or_default()
                    )
                };
                request_builder = request_builder.body(body.to_owned());
            }
        } else if body_type == "application/x-www-form-urlencoded"
            && request_body.contains_key("form")
        {
            let mut form_params = Vec::new();
            let form = request_body.get("form");
            if let Some(f) = form {
                match f.as_array() {
                    None => {}
                    Some(a) => {
                        for p in a {
                            let enabled = get_bool(p, "enabled", true);
                            let name = get_str(p, "name");
                            if !enabled || name.is_empty() {
                                continue;
                            }
                            let value = get_str(p, "value");
                            form_params.push((name, value));
                        }
                    }
                }
            }
            request_builder = request_builder.form(&form_params);
        } else if body_type == "binary" && request_body.contains_key("filePath") {
            let file_path = request_body
                .get("filePath")
                .ok_or(GenericError("filePath not set".to_string()))?
                .as_str()
                .unwrap_or_default();

            match fs::read(file_path).await.map_err(|e| e.to_string()) {
                Ok(f) => {
                    request_builder = request_builder.body(f);
                }
                Err(e) => {
                    return Ok(response_err(
                        &app_handle,
                        &*response.lock().await,
                        e,
                        &update_source,
                    ));
                }
            }
        } else if body_type == "multipart/form-data" && request_body.contains_key("form") {
            let mut multipart_form = multipart::Form::new();
            if let Some(form_definition) = request_body.get("form") {
                match form_definition.as_array() {
                    None => {}
                    Some(fd) => {
                        for p in fd {
                            let enabled = get_bool(p, "enabled", true);
                            let name = get_str(p, "name").to_string();

                            if !enabled || name.is_empty() {
                                continue;
                            }

                            let file_path = get_str(p, "file").to_owned();
                            let value = get_str(p, "value").to_owned();

                            let mut part = if file_path.is_empty() {
                                multipart::Part::text(value.clone())
                            } else {
                                match fs::read(file_path.clone()).await {
                                    Ok(f) => multipart::Part::bytes(f),
                                    Err(e) => {
                                        return Ok(response_err(
                                            &app_handle,
                                            &*response.lock().await,
                                            e.to_string(),
                                            &update_source,
                                        ));
                                    }
                                }
                            };

                            let content_type = get_str(p, "contentType");

                            // Set or guess mimetype
                            if !content_type.is_empty() {
                                part = match part.mime_str(content_type) {
                                    Ok(p) => p,
                                    Err(e) => {
                                        return Ok(response_err(
                                            &app_handle,
                                            &*response.lock().await,
                                            format!("Invalid mime for multi-part entry {e:?}"),
                                            &update_source,
                                        ));
                                    }
                                };
                            } else if !file_path.is_empty() {
                                let default_mime =
                                    Mime::from_str("application/octet-stream").unwrap();
                                let mime =
                                    mime_guess::from_path(file_path.clone()).first_or(default_mime);
                                part = match part.mime_str(mime.essence_str()) {
                                    Ok(p) => p,
                                    Err(e) => {
                                        return Ok(response_err(
                                            &app_handle,
                                            &*response.lock().await,
                                            format!("Invalid mime for multi-part entry {e:?}"),
                                            &update_source,
                                        ));
                                    }
                                };
                            }

                            // Set a file path if it is not empty
                            if !file_path.is_empty() {
                                let filename = PathBuf::from(file_path)
                                    .file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .to_string();
                                part = part.file_name(filename);
                            }

                            multipart_form = multipart_form.part(name, part);
                        }
                    }
                }
            }
            headers.remove("Content-Type"); // reqwest will add this automatically
            request_builder = request_builder.multipart(multipart_form);
        } else if request_body.contains_key("text") {
            let body = get_str_h(&request_body, "text");
            request_builder = request_builder.body(body.to_owned());
        } else {
            warn!("Unsupported body type: {}", body_type);
        }
    } else {
        // No body set
        let method = request.method.to_ascii_lowercase();
        let is_body_method = method == "post" || method == "put" || method == "patch";
        // Add Content-Length for methods that commonly accept a body because some servers
        // will error if they don't receive it.
        if is_body_method && !headers.contains_key("content-length") {
            headers.insert("Content-Length", HeaderValue::from_static("0"));
        }
    }

    // Add headers last, because previous steps may modify them
    request_builder = request_builder.headers(headers);

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
            let auth_result =
                plugin_manager.call_http_authentication(&window, &authentication_type, req).await;
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

fn ensure_proto(url_str: &str) -> String {
    if url_str.starts_with("http://") || url_str.starts_with("https://") {
        return url_str.to_string();
    }

    // Url::from_str will fail without a proto, so add one
    let parseable_url = format!("http://{}", url_str);
    if let Ok(u) = Url::from_str(parseable_url.as_str()) {
        match u.host() {
            Some(host) => {
                let h = host.to_string();
                // These TLDs force HTTPS
                if h.ends_with(".app") || h.ends_with(".dev") || h.ends_with(".page") {
                    return format!("https://{url_str}");
                }
            }
            None => {}
        }
    }

    format!("http://{url_str}")
}

fn get_bool(v: &Value, key: &str, fallback: bool) -> bool {
    match v.get(key) {
        None => fallback,
        Some(v) => v.as_bool().unwrap_or(fallback),
    }
}

fn get_str<'a>(v: &'a Value, key: &str) -> &'a str {
    match v.get(key) {
        None => "",
        Some(v) => v.as_str().unwrap_or_default(),
    }
}

fn get_str_h<'a>(v: &'a BTreeMap<String, Value>, key: &str) -> &'a str {
    match v.get(key) {
        None => "",
        Some(v) => v.as_str().unwrap_or_default(),
    }
}
