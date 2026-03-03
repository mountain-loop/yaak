use std::path::PathBuf;
use std::sync::Arc;
use tokio::task::JoinHandle;
use yaak::plugin_events::{
    GroupedPluginEvent, HostRequest, SharedPluginEventContext, handle_shared_plugin_event,
};
use yaak::render::render_http_request;
use yaak::send::{SendHttpRequestWithPluginsParams, send_http_request_with_plugins};
use yaak_crypto::manager::EncryptionManager;
use yaak_models::blob_manager::BlobManager;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    EmptyPayload, ErrorResponse, InternalEvent, InternalEventPayload, ListOpenWorkspacesResponse,
    RenderHttpRequestResponse, SendHttpRequestResponse, WorkspaceInfo,
};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::RenderOptions;

pub struct CliPluginEventBridge {
    rx_id: String,
    task: JoinHandle<()>,
}

struct CliSendHttpContext {
    blob_manager: BlobManager,
    plugin_manager: Arc<PluginManager>,
    encryption_manager: Arc<EncryptionManager>,
    response_dir: PathBuf,
}

impl CliPluginEventBridge {
    pub async fn start(
        plugin_manager: Arc<PluginManager>,
        query_manager: QueryManager,
        blob_manager: BlobManager,
        encryption_manager: Arc<EncryptionManager>,
        data_dir: PathBuf,
    ) -> Self {
        let (rx_id, mut rx) = plugin_manager.subscribe("cli").await;
        let rx_id_for_task = rx_id.clone();
        let pm = plugin_manager.clone();
        let send_http_context = Arc::new(CliSendHttpContext {
            blob_manager,
            plugin_manager,
            encryption_manager,
            response_dir: data_dir.join("responses"),
        });

        let task = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                // Events with reply IDs are replies to app-originated requests.
                if event.reply_id.is_some() {
                    continue;
                }

                let Some(plugin_handle) = pm.get_plugin_by_ref_id(&event.plugin_ref_id).await
                else {
                    eprintln!(
                        "Warning: Ignoring plugin event with unknown plugin ref '{}'",
                        event.plugin_ref_id
                    );
                    continue;
                };

                let pm = pm.clone();
                let query_manager = query_manager.clone();
                let send_http_context = send_http_context.clone();

                // Avoid deadlocks for nested plugin-host requests (for example, template functions
                // that trigger additional host requests during render) by handling each event in
                // its own task.
                tokio::spawn(async move {
                    let plugin_name = plugin_handle.info().name;
                    let Some(reply_payload) = build_plugin_reply(
                        &query_manager,
                        &event,
                        &plugin_name,
                        Some(send_http_context.as_ref()),
                    )
                    .await
                    else {
                        return;
                    };

                    if let Err(err) = pm.reply(&event, &reply_payload).await {
                        eprintln!("Warning: Failed replying to plugin event: {err}");
                    }
                });
            }

            pm.unsubscribe(&rx_id_for_task).await;
        });

        Self { rx_id, task }
    }

    pub async fn shutdown(self, plugin_manager: &PluginManager) {
        plugin_manager.unsubscribe(&self.rx_id).await;
        self.task.abort();
        let _ = self.task.await;
    }
}

async fn build_plugin_reply(
    query_manager: &QueryManager,
    event: &InternalEvent,
    plugin_name: &str,
    send_http_context: Option<&CliSendHttpContext>,
) -> Option<InternalEventPayload> {
    match handle_shared_plugin_event(
        query_manager,
        &event.payload,
        SharedPluginEventContext {
            plugin_name,
            workspace_id: event.context.workspace_id.as_deref(),
        },
    ) {
        GroupedPluginEvent::Handled(payload) => payload,
        GroupedPluginEvent::ToHandle(host_request) => match host_request {
            HostRequest::ErrorResponse(resp) => {
                eprintln!("[plugin:{}] error: {}", plugin_name, resp.error);
                None
            }
            HostRequest::ReloadResponse(_) => None,
            HostRequest::ShowToast(req) => {
                eprintln!("[plugin:{}] {}", plugin_name, req.message);
                Some(InternalEventPayload::ShowToastResponse(EmptyPayload {}))
            }
            HostRequest::ListOpenWorkspaces(_) => {
                let workspaces = match query_manager.connect().list_workspaces() {
                    Ok(workspaces) => workspaces
                        .into_iter()
                        .map(|w| WorkspaceInfo { id: w.id.clone(), name: w.name, label: w.id })
                        .collect(),
                    Err(err) => {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to list workspaces in CLI: {err}"),
                        }));
                    }
                };
                Some(InternalEventPayload::ListOpenWorkspacesResponse(ListOpenWorkspacesResponse {
                    workspaces,
                }))
            }
            HostRequest::SendHttpRequest(send_http_request_request) => {
                let Some(send_ctx) = send_http_context else {
                    return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: "Send HTTP request support is not initialized in CLI".to_string(),
                    }));
                };

                let mut http_request = send_http_request_request.http_request.clone();
                if http_request.workspace_id.is_empty() {
                    let Some(workspace_id) = event.context.workspace_id.clone() else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to send HTTP requests in CLI"
                                .to_string(),
                        }));
                    };
                    http_request.workspace_id = workspace_id;
                }

                let mut plugin_context = event.context.clone();
                if plugin_context.workspace_id.is_none() {
                    plugin_context.workspace_id = Some(http_request.workspace_id.clone());
                }

                match send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
                    query_manager,
                    blob_manager: &send_ctx.blob_manager,
                    request: http_request,
                    environment_id: None,
                    update_source: UpdateSource::Plugin,
                    cookie_jar_id: None,
                    response_dir: &send_ctx.response_dir,
                    emit_events_to: None,
                    emit_response_body_chunks_to: None,
                    existing_response: None,
                    plugin_manager: send_ctx.plugin_manager.clone(),
                    encryption_manager: send_ctx.encryption_manager.clone(),
                    plugin_context: &plugin_context,
                    cancelled_rx: None,
                    connection_manager: None,
                })
                .await
                {
                    Ok(result) => Some(InternalEventPayload::SendHttpRequestResponse(
                        SendHttpRequestResponse { http_response: result.response },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to send HTTP request in CLI: {err}"),
                    })),
                }
            }
            HostRequest::CopyText(copy_text_request) => todo!("copy_text_request"),
            HostRequest::PromptText(prompt_text_request) => todo!("prompt_text_request"),
            HostRequest::PromptForm(prompt_form_request) => todo!("prompt_form_request"),
            HostRequest::RenderGrpcRequest(render_grpc_request_request) => todo!("render_grpc"),
            HostRequest::RenderHttpRequest(render_http_request_request) => {
                let Some(send_ctx) = send_http_context else {
                    return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: "Render HTTP request support is not initialized in CLI".to_string(),
                    }));
                };

                let mut http_request = render_http_request_request.http_request.clone();
                if http_request.workspace_id.is_empty() {
                    let Some(workspace_id) = event.context.workspace_id.clone() else {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: "workspace_id is required to render HTTP requests in CLI"
                                .to_string(),
                        }));
                    };
                    http_request.workspace_id = workspace_id;
                }

                let mut plugin_context = event.context.clone();
                if plugin_context.workspace_id.is_none() {
                    plugin_context.workspace_id = Some(http_request.workspace_id.clone());
                }

                let environment_chain = match query_manager.connect().resolve_environments(
                    &http_request.workspace_id,
                    http_request.folder_id.as_deref(),
                    None,
                ) {
                    Ok(chain) => chain,
                    Err(err) => {
                        return Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to resolve environments in CLI: {err}"),
                        }));
                    }
                };

                let template_callback = PluginTemplateCallback::new(
                    send_ctx.plugin_manager.clone(),
                    send_ctx.encryption_manager.clone(),
                    &plugin_context,
                    render_http_request_request.purpose.clone(),
                );
                let render_options = RenderOptions::throw();

                match render_http_request(
                    &http_request,
                    environment_chain,
                    &template_callback,
                    &render_options,
                )
                .await
                {
                    Ok(http_request) => Some(InternalEventPayload::RenderHttpRequestResponse(
                        RenderHttpRequestResponse { http_request },
                    )),
                    Err(err) => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to render HTTP request in CLI: {err}"),
                    })),
                }
            }
            HostRequest::TemplateRender(template_render_request) => todo!("template_render"),
            HostRequest::OpenWindow(open_window_request) => todo!("open_window"),
            HostRequest::CloseWindow(close_window_request) => todo!("close_window"),
            HostRequest::OpenExternalUrl(open_external_url_request) => todo!("open_url"),
            HostRequest::ListCookieNames(list_cookie_names_request) => todo!("list_cookie"),
            HostRequest::GetCookieValue(get_cookie_value_request) => todo!("get_cookie"),
            HostRequest::WindowInfo(window_info_request) => todo!("window_info"),
            HostRequest::OtherRequest(internal_event_payload) => todo!("other"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use yaak_models::models::HttpRequest;
    use yaak_plugins::events::{GetKeyValueRequest, PluginContext, SendHttpRequestRequest};

    fn query_manager_for_test() -> (QueryManager, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let db_path = temp_dir.path().join("db.sqlite");
        let blob_path = temp_dir.path().join("blobs.sqlite");
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize DB");
        (query_manager, temp_dir)
    }

    fn event(payload: InternalEventPayload) -> InternalEvent {
        InternalEvent {
            id: "evt_1".to_string(),
            plugin_ref_id: "plugin_ref_1".to_string(),
            plugin_name: "@yaak/test-plugin".to_string(),
            reply_id: None,
            context: PluginContext::new_empty(),
            payload,
        }
    }

    #[tokio::test]
    async fn key_value_requests_round_trip() {
        let (query_manager, _temp_dir) = query_manager_for_test();
        let plugin_name = "@yaak/test-plugin";

        let get_missing = build_plugin_reply(
            &query_manager,
            &event(InternalEventPayload::GetKeyValueRequest(GetKeyValueRequest {
                key: "missing".to_string(),
            })),
            plugin_name,
            None,
        )
        .await;
        match get_missing {
            Some(InternalEventPayload::GetKeyValueResponse(r)) => assert_eq!(r.value, None),
            other => panic!("unexpected payload for missing get: {other:?}"),
        }

        let set = build_plugin_reply(
            &query_manager,
            &event(InternalEventPayload::SetKeyValueRequest(
                yaak_plugins::events::SetKeyValueRequest {
                    key: "token".to_string(),
                    value: "{\"access_token\":\"abc\"}".to_string(),
                },
            )),
            plugin_name,
            None,
        )
        .await;
        assert!(matches!(set, Some(InternalEventPayload::SetKeyValueResponse(_))));

        let get_present = build_plugin_reply(
            &query_manager,
            &event(InternalEventPayload::GetKeyValueRequest(GetKeyValueRequest {
                key: "token".to_string(),
            })),
            plugin_name,
            None,
        )
        .await;
        match get_present {
            Some(InternalEventPayload::GetKeyValueResponse(r)) => {
                assert_eq!(r.value, Some("{\"access_token\":\"abc\"}".to_string()))
            }
            other => panic!("unexpected payload for present get: {other:?}"),
        }

        let delete = build_plugin_reply(
            &query_manager,
            &event(InternalEventPayload::DeleteKeyValueRequest(
                yaak_plugins::events::DeleteKeyValueRequest { key: "token".to_string() },
            )),
            plugin_name,
            None,
        )
        .await;
        match delete {
            Some(InternalEventPayload::DeleteKeyValueResponse(r)) => assert!(r.deleted),
            other => panic!("unexpected payload for delete: {other:?}"),
        }
    }

    #[tokio::test]
    async fn send_http_request_without_context_gets_error_reply() {
        let (query_manager, _temp_dir) = query_manager_for_test();
        let payload = build_plugin_reply(
            &query_manager,
            &event(InternalEventPayload::SendHttpRequestRequest(SendHttpRequestRequest {
                http_request: HttpRequest::default(),
            })),
            "@yaak/test-plugin",
            None,
        )
        .await;

        match payload {
            Some(InternalEventPayload::ErrorResponse(err)) => {
                assert!(err.error.contains("Send HTTP request support is not initialized in CLI"));
            }
            other => panic!("unexpected payload for unsupported request: {other:?}"),
        }
    }
}
