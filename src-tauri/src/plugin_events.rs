use crate::http_request::send_http_request;
use crate::render::{render_http_request, render_json_value};
use crate::window::{create_window, CreateWindowConfig};
use crate::{
    call_frontend, cookie_jar_from_window, environment_from_window, get_window_from_window_context,
    workspace_from_window,
};
use chrono::Utc;
use log::warn;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use yaak_models::models::{HttpResponse, Plugin};
use yaak_models::queries::{
    create_default_http_response, delete_plugin_key_value, get_base_environment, get_http_request,
    get_plugin_key_value, list_http_responses_for_request, list_plugins, set_plugin_key_value,
    upsert_plugin, UpdateSource,
};
use yaak_plugins::events::{
    Color, DeleteKeyValueResponse, EmptyPayload, FindHttpResponsesResponse,
    GetHttpRequestByIdResponse, GetKeyValueResponse, Icon, InternalEvent, InternalEventPayload,
    RenderHttpRequestResponse, SendHttpRequestResponse, SetKeyValueResponse, ShowToastRequest,
    TemplateRenderResponse, WindowContext, WindowNavigateEvent,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::plugin_handle::PluginHandle;
use yaak_plugins::template_callback::PluginTemplateCallback;

pub(crate) async fn handle_plugin_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    event: &InternalEvent,
    plugin_handle: &PluginHandle,
) {
    // info!("Got event to app {}", event.id);
    let window_context = event.window_context.to_owned();
    let response_event: Option<InternalEventPayload> = match event.clone().payload {
        InternalEventPayload::CopyTextRequest(req) => {
            app_handle
                .clipboard()
                .write_text(req.text.as_str())
                .expect("Failed to write text to clipboard");
            Some(InternalEventPayload::CopyTextResponse(EmptyPayload {}))
        }
        InternalEventPayload::ShowToastRequest(req) => {
            match window_context {
                WindowContext::Label { label } => app_handle
                    .emit_to(label, "show_toast", req)
                    .expect("Failed to emit show_toast to window"),
                _ => app_handle.emit("show_toast", req).expect("Failed to emit show_toast"),
            };
            Some(InternalEventPayload::ShowToastResponse(EmptyPayload {}))
        }
        InternalEventPayload::PromptTextRequest(_) => {
            let window = get_window_from_window_context(app_handle, &window_context)
                .expect("Failed to find window for render");
            call_frontend(window, event).await
        }
        InternalEventPayload::FindHttpResponsesRequest(req) => {
            let http_responses = list_http_responses_for_request(
                app_handle,
                req.request_id.as_str(),
                req.limit.map(|l| l as i64),
            )
            .await
            .unwrap_or_default();
            Some(InternalEventPayload::FindHttpResponsesResponse(FindHttpResponsesResponse {
                http_responses,
            }))
        }
        InternalEventPayload::GetHttpRequestByIdRequest(req) => {
            let http_request = get_http_request(app_handle, req.id.as_str()).await.unwrap();
            Some(InternalEventPayload::GetHttpRequestByIdResponse(GetHttpRequestByIdResponse {
                http_request,
            }))
        }
        InternalEventPayload::RenderHttpRequestRequest(req) => {
            let window = get_window_from_window_context(app_handle, &window_context)
                .expect("Failed to find window for render http request");

            let workspace = workspace_from_window(&window)
                .await
                .expect("Failed to get workspace_id from window URL");
            let environment = environment_from_window(&window).await;
            let base_environment = get_base_environment(&window, workspace.id.as_str())
                .await
                .expect("Failed to get base environment");
            let cb = PluginTemplateCallback::new(app_handle, &window_context, req.purpose);
            let http_request = render_http_request(
                &req.http_request,
                &base_environment,
                environment.as_ref(),
                &cb,
            )
            .await;
            Some(InternalEventPayload::RenderHttpRequestResponse(RenderHttpRequestResponse {
                http_request,
            }))
        }
        InternalEventPayload::TemplateRenderRequest(req) => {
            let window = get_window_from_window_context(app_handle, &window_context)
                .expect("Failed to find window for render");

            let workspace = workspace_from_window(&window)
                .await
                .expect("Failed to get workspace_id from window URL");
            let environment = environment_from_window(&window).await;
            let base_environment = get_base_environment(&window, workspace.id.as_str())
                .await
                .expect("Failed to get base environment");
            let cb = PluginTemplateCallback::new(app_handle, &window_context, req.purpose);
            let data =
                render_json_value(req.data, &base_environment, environment.as_ref(), &cb).await;
            Some(InternalEventPayload::TemplateRenderResponse(TemplateRenderResponse { data }))
        }
        InternalEventPayload::ErrorResponse(resp) => {
            let window = get_window_from_window_context(app_handle, &window_context)
                .expect("Failed to find window for plugin reload");
            let toast_event = plugin_handle.build_event_to_send(
                &WindowContext::from_window(&window),
                &InternalEventPayload::ShowToastRequest(ShowToastRequest {
                    message: format!(
                        "Plugin error from {}: {}",
                        plugin_handle.name().await,
                        resp.error
                    ),
                    color: Some(Color::Danger),
                    ..Default::default()
                }),
                None,
            );
            Box::pin(handle_plugin_event(app_handle, &toast_event, plugin_handle)).await;
            None
        }
        InternalEventPayload::ReloadResponse(_) => {
            let window = get_window_from_window_context(app_handle, &window_context)
                .expect("Failed to find window for plugin reload");
            let plugins = list_plugins(app_handle).await.unwrap();
            for plugin in plugins {
                if plugin.directory != plugin_handle.dir {
                    continue;
                }

                let new_plugin = Plugin {
                    updated_at: Utc::now().naive_utc(), // TODO: Add reloaded_at field to use instead
                    ..plugin
                };
                upsert_plugin(&window, new_plugin, &UpdateSource::Plugin).await.unwrap();
            }
            let toast_event = plugin_handle.build_event_to_send(
                &WindowContext::from_window(&window),
                &InternalEventPayload::ShowToastRequest(ShowToastRequest {
                    message: format!("Reloaded plugin {}", plugin_handle.dir),
                    icon: Some(Icon::Info),
                    ..Default::default()
                }),
                None,
            );
            Box::pin(handle_plugin_event(app_handle, &toast_event, plugin_handle)).await;
            None
        }
        InternalEventPayload::SendHttpRequestRequest(req) => {
            let window = get_window_from_window_context(app_handle, &window_context)
                .expect("Failed to find window for sending HTTP request");
            let mut http_request = req.http_request;
            let workspace = workspace_from_window(&window)
                .await
                .expect("Failed to get workspace_id from window URL");
            let cookie_jar = cookie_jar_from_window(&window).await;
            let environment = environment_from_window(&window).await;

            if http_request.workspace_id.is_empty() {
                http_request.workspace_id = workspace.id;
            }

            let resp = if http_request.id.is_empty() {
                HttpResponse::new()
            } else {
                create_default_http_response(
                    &window,
                    http_request.id.as_str(),
                    &UpdateSource::Plugin,
                )
                .await
                .unwrap()
            };

            let result = send_http_request(
                &window,
                &http_request,
                &resp,
                environment,
                cookie_jar,
                &mut tokio::sync::watch::channel(false).1, // No-op cancel channel
            )
            .await;

            let http_response = match result {
                Ok(r) => r,
                Err(_e) => return,
            };

            Some(InternalEventPayload::SendHttpRequestResponse(SendHttpRequestResponse {
                http_response,
            }))
        }
        InternalEventPayload::OpenWindowRequest(req) => {
            let label = req.label;
            let (tx, mut rx) = tokio::sync::mpsc::channel(128);
            let win_config = CreateWindowConfig {
                url: &req.url,
                label: &label.clone(),
                title: &req.title.unwrap_or_default(),
                navigation_tx: Some(tx),
                inner_size: req.size.map(|s| (s.width, s.height)),
                position: None,
                hide_titlebar: false,
            };
            create_window(app_handle, win_config);

            let event_id = event.id.clone();
            let plugin_handle = plugin_handle.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(url) = rx.recv().await {
                    let label = label.clone();
                    let url = url.to_string();
                    let event_to_send = plugin_handle.build_event_to_send(
                        &WindowContext::Label { label },
                        &InternalEventPayload::WindowNavigateEvent(WindowNavigateEvent { url }),
                        Some(event_id.clone()),
                    );
                    plugin_handle.send(&event_to_send).await.unwrap();
                }
            });
            None
        }
        InternalEventPayload::CloseWindowRequest(req) => {
            if let Some(window) = app_handle.webview_windows().get(&req.label) {
                window.close().expect("Failed to close window");
            }
            None
        }
        InternalEventPayload::SetKeyValueRequest(req) => {
            let name = plugin_handle.name().await;
            set_plugin_key_value(app_handle, &name, &req.key, &req.value).await;
            Some(InternalEventPayload::SetKeyValueResponse(SetKeyValueResponse {}))
        }
        InternalEventPayload::GetKeyValueRequest(req) => {
            let name = plugin_handle.name().await;
            let value = get_plugin_key_value(app_handle, &name, &req.key).await.map(|v| v.value);
            Some(InternalEventPayload::GetKeyValueResponse(GetKeyValueResponse { value }))
        }
        InternalEventPayload::DeleteKeyValueRequest(req) => {
            let name = plugin_handle.name().await;
            let deleted = delete_plugin_key_value(app_handle, &name, &req.key).await;
            Some(InternalEventPayload::DeleteKeyValueResponse(DeleteKeyValueResponse { deleted }))
        }
        _ => None,
    };

    if let Some(e) = response_event {
        let plugin_manager: State<'_, PluginManager> = app_handle.state();
        if let Err(e) = plugin_manager.reply(&event, &e).await {
            warn!("Failed to reply to plugin manager: {:?}", e)
        }
    }
}
