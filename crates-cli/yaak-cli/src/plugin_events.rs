use std::sync::Arc;
use tokio::task::JoinHandle;
use yaak::plugin_events::{
    GroupedPluginEvent, HostRequest, SharedPluginEventContext, handle_shared_plugin_event,
};
use yaak_models::query_manager::QueryManager;
use yaak_plugins::events::{
    EmptyPayload, ErrorResponse, InternalEvent, InternalEventPayload, ListOpenWorkspacesResponse,
    WorkspaceInfo,
};
use yaak_plugins::manager::PluginManager;

pub struct CliPluginEventBridge {
    rx_id: String,
    task: JoinHandle<()>,
}

impl CliPluginEventBridge {
    pub async fn start(plugin_manager: Arc<PluginManager>, query_manager: QueryManager) -> Self {
        let (rx_id, mut rx) = plugin_manager.subscribe("cli").await;
        let rx_id_for_task = rx_id.clone();
        let pm = plugin_manager.clone();

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

                let plugin_name = plugin_handle.info().name;
                let Some(reply_payload) = build_plugin_reply(&query_manager, &event, &plugin_name)
                else {
                    continue;
                };

                if let Err(err) = pm.reply(&event, &reply_payload).await {
                    eprintln!("Warning: Failed replying to plugin event: {err}");
                }
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

fn build_plugin_reply(
    query_manager: &QueryManager,
    event: &InternalEvent,
    plugin_name: &str,
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
            req => Some(InternalEventPayload::ErrorResponse(ErrorResponse {
                error: format!("Unsupported plugin request in CLI: {}", req.type_name()),
            })),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use yaak_plugins::events::{GetKeyValueRequest, PluginContext, WindowInfoRequest};

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

    #[test]
    fn key_value_requests_round_trip() {
        let (query_manager, _temp_dir) = query_manager_for_test();
        let plugin_name = "@yaak/test-plugin";

        let get_missing = build_plugin_reply(
            &query_manager,
            &event(InternalEventPayload::GetKeyValueRequest(GetKeyValueRequest {
                key: "missing".to_string(),
            })),
            plugin_name,
        );
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
        );
        assert!(matches!(set, Some(InternalEventPayload::SetKeyValueResponse(_))));

        let get_present = build_plugin_reply(
            &query_manager,
            &event(InternalEventPayload::GetKeyValueRequest(GetKeyValueRequest {
                key: "token".to_string(),
            })),
            plugin_name,
        );
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
        );
        match delete {
            Some(InternalEventPayload::DeleteKeyValueResponse(r)) => assert!(r.deleted),
            other => panic!("unexpected payload for delete: {other:?}"),
        }
    }

    #[test]
    fn unsupported_request_gets_error_reply() {
        let (query_manager, _temp_dir) = query_manager_for_test();
        let payload = build_plugin_reply(
            &query_manager,
            &event(InternalEventPayload::WindowInfoRequest(WindowInfoRequest {
                label: "main".to_string(),
            })),
            "@yaak/test-plugin",
        );

        match payload {
            Some(InternalEventPayload::ErrorResponse(err)) => {
                assert!(err.error.contains("Unsupported plugin request in CLI"));
                assert!(err.error.contains("window_info_request"));
            }
            other => panic!("unexpected payload for unsupported request: {other:?}"),
        }
    }
}
