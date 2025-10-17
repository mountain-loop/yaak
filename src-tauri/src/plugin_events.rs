use crate::error::Result;
use crate::http_request::send_http_request;
use crate::render::{render_grpc_request, render_http_request, render_json_value};
use crate::window::{CreateWindowConfig, create_window};
use crate::{
    call_frontend, cookie_jar_from_window, environment_from_window, get_window_from_window_context,
    workspace_from_window,
};
use chrono::Utc;
use cookie::Cookie;
use log::error;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use yaak_common::window::WorkspaceWindowTrait;
use yaak_models::models::{HttpResponse, Plugin};
use yaak_models::queries::any_request::AnyRequest;
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    Color, DeleteKeyValueResponse, EmptyPayload, ErrorResponse, FindHttpResponsesResponse,
    GetCookieValueResponse, GetHttpRequestByIdResponse, GetKeyValueResponse, Icon, InternalEvent,
    InternalEventPayload, ListCookieNamesResponse, PluginWindowContext, RenderGrpcRequestResponse,
    RenderHttpRequestResponse, SendHttpRequestResponse, SetKeyValueResponse, ShowToastRequest,
    TemplateRenderResponse, WindowNavigateEvent,
};
use yaak_plugins::plugin_handle::PluginHandle;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderErrorBehavior, RenderOptions};

pub(crate) async fn handle_plugin_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    event: &InternalEvent,
    plugin_handle: &PluginHandle,
) -> Result<Option<InternalEventPayload>> {
    // debug!("Got event to app {event:?}");
    let window_context = event.window_context.to_owned();
    match event.clone().payload {
        InternalEventPayload::CopyTextRequest(req) => {
            app_handle.clipboard().write_text(req.text.as_str())?;
            Ok(Some(InternalEventPayload::CopyTextResponse(EmptyPayload {})))
        }
        InternalEventPayload::ShowToastRequest(req) => {
            match window_context {
                PluginWindowContext::Label { label, .. } => {
                    app_handle.emit_to(label, "show_toast", req)?
                }
                _ => app_handle.emit("show_toast", req)?,
            };
            Ok(Some(InternalEventPayload::ShowToastResponse(EmptyPayload {})))
        }
        InternalEventPayload::PromptTextRequest(_) => {
            let window = get_window_from_window_context(app_handle, &window_context)?;
            Ok(call_frontend(&window, event).await)
        }
        InternalEventPayload::FindHttpResponsesRequest(req) => {
            let http_responses = app_handle
                .db()
                .list_http_responses_for_request(&req.request_id, req.limit.map(|l| l as u64))
                .unwrap_or_default();
            Ok(Some(InternalEventPayload::FindHttpResponsesResponse(FindHttpResponsesResponse {
                http_responses,
            })))
        }
        InternalEventPayload::GetHttpRequestByIdRequest(req) => {
            let http_request = app_handle.db().get_http_request(&req.id).ok();
            Ok(Some(InternalEventPayload::GetHttpRequestByIdResponse(GetHttpRequestByIdResponse {
                http_request,
            })))
        }
        InternalEventPayload::RenderGrpcRequestRequest(req) => {
            let window = get_window_from_window_context(app_handle, &window_context)?;

            let workspace =
                workspace_from_window(&window).expect("Failed to get workspace_id from window URL");
            let environment_id = environment_from_window(&window).map(|e| e.id);
            let environment_chain = window.db().resolve_environments(
                &workspace.id,
                req.grpc_request.folder_id.as_deref(),
                environment_id.as_deref(),
            )?;
            let cb = PluginTemplateCallback::new(app_handle, &window_context, req.purpose);
            let opt = RenderOptions {
                error_behavior: RenderErrorBehavior::Throw,
            };
            let grpc_request =
                render_grpc_request(&req.grpc_request, environment_chain, &cb, &opt).await?;
            Ok(Some(InternalEventPayload::RenderGrpcRequestResponse(RenderGrpcRequestResponse {
                grpc_request,
            })))
        }
        InternalEventPayload::RenderHttpRequestRequest(req) => {
            let window = get_window_from_window_context(app_handle, &window_context)?;

            let workspace =
                workspace_from_window(&window).expect("Failed to get workspace_id from window URL");
            let environment_id = environment_from_window(&window).map(|e| e.id);
            let environment_chain = window.db().resolve_environments(
                &workspace.id,
                req.http_request.folder_id.as_deref(),
                environment_id.as_deref(),
            )?;
            let cb = PluginTemplateCallback::new(app_handle, &window_context, req.purpose);
            let opt = &RenderOptions {
                error_behavior: RenderErrorBehavior::Throw,
            };
            let http_request =
                render_http_request(&req.http_request, environment_chain, &cb, &opt).await?;
            Ok(Some(InternalEventPayload::RenderHttpRequestResponse(RenderHttpRequestResponse {
                http_request,
            })))
        }
        InternalEventPayload::TemplateRenderRequest(req) => {
            let window = get_window_from_window_context(app_handle, &window_context)?;

            let workspace =
                workspace_from_window(&window).expect("Failed to get workspace_id from window URL");
            let environment_id = environment_from_window(&window).map(|e| e.id);
            let folder_id = if let Some(id) = window.request_id() {
                match window.db().get_any_request(&id) {
                    Ok(AnyRequest::HttpRequest(r)) => r.folder_id,
                    Ok(AnyRequest::GrpcRequest(r)) => r.folder_id,
                    Ok(AnyRequest::WebsocketRequest(r)) => r.folder_id,
                    Err(_) => None,
                }
            } else {
                None
            };
            let environment_chain = window.db().resolve_environments(
                &workspace.id,
                folder_id.as_deref(),
                environment_id.as_deref(),
            )?;
            let cb = PluginTemplateCallback::new(app_handle, &window_context, req.purpose);
            let opt = RenderOptions {
                error_behavior: RenderErrorBehavior::Throw,
            };
            let data = render_json_value(req.data, environment_chain, &cb, &opt).await?;
            Ok(Some(InternalEventPayload::TemplateRenderResponse(TemplateRenderResponse { data })))
        }
        InternalEventPayload::ErrorResponse(resp) => {
            error!("Plugin error: {}: {:?}", resp.error, resp);
            let toast_event = plugin_handle.build_event_to_send(
                &window_context,
                &InternalEventPayload::ShowToastRequest(ShowToastRequest {
                    message: format!(
                        "Plugin error from {}: {}",
                        plugin_handle.info().name,
                        resp.error
                    ),
                    color: Some(Color::Danger),
                    timeout: Some(30000),
                    ..Default::default()
                }),
                None,
            );
            Box::pin(handle_plugin_event(app_handle, &toast_event, plugin_handle)).await
        }
        InternalEventPayload::ReloadResponse(req) => {
            let plugins = app_handle.db().list_plugins()?;
            for plugin in plugins {
                if plugin.directory != plugin_handle.dir {
                    continue;
                }

                let new_plugin = Plugin {
                    updated_at: Utc::now().naive_utc(), // TODO: Add reloaded_at field to use instead
                    ..plugin
                };
                app_handle.db().upsert_plugin(&new_plugin, &UpdateSource::Plugin)?;
            }

            if !req.silent {
                let info = plugin_handle.info();
                let toast_event = plugin_handle.build_event_to_send(
                    &window_context,
                    &InternalEventPayload::ShowToastRequest(ShowToastRequest {
                        message: format!("Reloaded plugin {}@{}", info.name, info.version),
                        icon: Some(Icon::Info),
                        timeout: Some(3000),
                        ..Default::default()
                    }),
                    None,
                );
                Box::pin(handle_plugin_event(app_handle, &toast_event, plugin_handle)).await
            } else {
                Ok(None)
            }
        }
        InternalEventPayload::SendHttpRequestRequest(req) => {
            let window = get_window_from_window_context(app_handle, &window_context)?;
            let mut http_request = req.http_request;
            let workspace =
                workspace_from_window(&window).expect("Failed to get workspace_id from window URL");
            let cookie_jar = cookie_jar_from_window(&window);
            let environment = environment_from_window(&window);

            if http_request.workspace_id.is_empty() {
                http_request.workspace_id = workspace.id;
            }

            let http_response = if http_request.id.is_empty() {
                HttpResponse::default()
            } else {
                window.db().upsert_http_response(
                    &HttpResponse {
                        request_id: http_request.id.clone(),
                        workspace_id: http_request.workspace_id.clone(),
                        ..Default::default()
                    },
                    &UpdateSource::Plugin,
                )?
            };

            let http_response = send_http_request(
                &window,
                &http_request,
                &http_response,
                environment,
                cookie_jar,
                &mut tokio::sync::watch::channel(false).1, // No-op cancel channel
            )
            .await?;

            Ok(Some(InternalEventPayload::SendHttpRequestResponse(SendHttpRequestResponse {
                http_response,
            })))
        }
        InternalEventPayload::OpenWindowRequest(req) => {
            let (navigation_tx, mut navigation_rx) = tokio::sync::mpsc::channel(128);
            let (close_tx, mut close_rx) = tokio::sync::mpsc::channel(128);
            let win_config = CreateWindowConfig {
                url: &req.url,
                label: &req.label,
                title: &req.title.clone().unwrap_or_default(),
                navigation_tx: Some(navigation_tx),
                close_tx: Some(close_tx),
                inner_size: req.size.clone().map(|s| (s.width, s.height)),
                data_dir_key: req.data_dir_key.clone(),
                ..Default::default()
            };
            if let Err(e) = create_window(app_handle, win_config) {
                let error_event = plugin_handle.build_event_to_send(
                    &window_context,
                    &InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to create window: {:?}", e),
                    }),
                    None,
                );
                return Box::pin(handle_plugin_event(app_handle, &error_event, plugin_handle))
                    .await;
            }

            {
                let event_id = event.id.clone();
                let plugin_handle = plugin_handle.clone();
                let window_context = window_context.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(url) = navigation_rx.recv().await {
                        let url = url.to_string();
                        let event_to_send = plugin_handle.build_event_to_send(
                            &window_context, // NOTE: Sending existing context on purpose here
                            &InternalEventPayload::WindowNavigateEvent(WindowNavigateEvent { url }),
                            Some(event_id.clone()),
                        );
                        plugin_handle.send(&event_to_send).await.unwrap();
                    }
                });
            }

            {
                let event_id = event.id.clone();
                let plugin_handle = plugin_handle.clone();
                let window_context = window_context.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(_) = close_rx.recv().await {
                        let event_to_send = plugin_handle.build_event_to_send(
                            &window_context,
                            &InternalEventPayload::WindowCloseEvent,
                            Some(event_id.clone()),
                        );
                        plugin_handle.send(&event_to_send).await.unwrap();
                    }
                });
            }

            Ok(None)
        }
        InternalEventPayload::CloseWindowRequest(req) => {
            if let Some(window) = app_handle.webview_windows().get(&req.label) {
                window.close()?;
            }
            Ok(None)
        }
        InternalEventPayload::SetKeyValueRequest(req) => {
            let name = plugin_handle.info().name;
            app_handle.db().set_plugin_key_value(&name, &req.key, &req.value);
            Ok(Some(InternalEventPayload::SetKeyValueResponse(SetKeyValueResponse {})))
        }
        InternalEventPayload::GetKeyValueRequest(req) => {
            let name = plugin_handle.info().name;
            let value = app_handle.db().get_plugin_key_value(&name, &req.key).map(|v| v.value);
            Ok(Some(InternalEventPayload::GetKeyValueResponse(GetKeyValueResponse { value })))
        }
        InternalEventPayload::DeleteKeyValueRequest(req) => {
            let name = plugin_handle.info().name;
            let deleted = app_handle.db().delete_plugin_key_value(&name, &req.key)?;
            Ok(Some(InternalEventPayload::DeleteKeyValueResponse(DeleteKeyValueResponse {
                deleted,
            })))
        }
        InternalEventPayload::ListCookieNamesRequest(_req) => {
            let window = get_window_from_window_context(app_handle, &window_context)?;
            let names = match cookie_jar_from_window(&window) {
                None => Vec::new(),
                Some(j) => j
                    .cookies
                    .into_iter()
                    .filter_map(|c| Cookie::parse(c.raw_cookie).ok().map(|c| c.name().to_string()))
                    .collect(),
            };
            Ok(Some(InternalEventPayload::ListCookieNamesResponse(ListCookieNamesResponse {
                names,
            })))
        }
        InternalEventPayload::GetCookieValueRequest(req) => {
            let window = get_window_from_window_context(app_handle, &window_context)?;
            let value = match cookie_jar_from_window(&window) {
                None => None,
                Some(j) => j.cookies.into_iter().find_map(|c| match Cookie::parse(c.raw_cookie) {
                    Ok(c) if c.name().to_string().eq(&req.name) => {
                        Some(c.value_trimmed().to_string())
                    }
                    _ => None,
                }),
            };
            Ok(Some(InternalEventPayload::GetCookieValueResponse(GetCookieValueResponse { value })))
        }
        _ => Ok(None),
    }
}
