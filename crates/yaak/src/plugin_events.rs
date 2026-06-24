use yaak_models::models::AnyModel;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{
    CloseWindowRequest, CopyTextRequest, DeleteKeyValueRequest, DeleteKeyValueResponse,
    DeleteModelRequest, DeleteModelResponse, ErrorResponse, FindHttpResponsesRequest,
    FindHttpResponsesResponse, GetCookieValueRequest, GetHttpRequestByIdRequest,
    GetHttpRequestByIdResponse, GetKeyValueRequest, GetKeyValueResponse, InternalEventPayload,
    ListCookieNamesRequest, ListFoldersRequest, ListFoldersResponse, ListHttpRequestsRequest,
    ListHttpRequestsResponse, ListOpenWorkspacesRequest, OpenExternalUrlRequest, OpenWindowRequest,
    PromptFormRequest, PromptTextRequest, ReloadResponse, RenderGrpcRequestRequest,
    RenderHttpRequestRequest, SendHttpRequestRequest, SetKeyValueRequest, ShowToastRequest,
    TemplateRenderRequest, UpsertModelRequest, UpsertModelResponse, WindowInfoRequest,
};

pub struct SharedPluginEventContext<'a> {
    pub plugin_name: &'a str,
    pub workspace_id: Option<&'a str>,
}

#[derive(Debug)]
pub enum GroupedPluginEvent<'a> {
    Handled(Option<InternalEventPayload>),
    ToHandle(HostRequest<'a>),
}

#[derive(Debug)]
pub enum GroupedPluginRequest<'a> {
    Shared(SharedRequest<'a>),
    Host(HostRequest<'a>),
    Ignore,
}

#[derive(Debug)]
pub enum SharedRequest<'a> {
    GetKeyValue(&'a GetKeyValueRequest),
    SetKeyValue(&'a SetKeyValueRequest),
    DeleteKeyValue(&'a DeleteKeyValueRequest),
    GetHttpRequestById(&'a GetHttpRequestByIdRequest),
    ListFolders(&'a ListFoldersRequest),
    ListHttpRequests(&'a ListHttpRequestsRequest),
    FindHttpResponses(&'a FindHttpResponsesRequest),
    UpsertModel(&'a UpsertModelRequest),
    DeleteModel(&'a DeleteModelRequest),
}

#[derive(Debug)]
pub enum HostRequest<'a> {
    ShowToast(&'a ShowToastRequest),
    CopyText(&'a CopyTextRequest),
    PromptText(&'a PromptTextRequest),
    PromptForm(&'a PromptFormRequest),
    RenderGrpcRequest(&'a RenderGrpcRequestRequest),
    RenderHttpRequest(&'a RenderHttpRequestRequest),
    TemplateRender(&'a TemplateRenderRequest),
    SendHttpRequest(&'a SendHttpRequestRequest),
    OpenWindow(&'a OpenWindowRequest),
    CloseWindow(&'a CloseWindowRequest),
    OpenExternalUrl(&'a OpenExternalUrlRequest),
    ListOpenWorkspaces(&'a ListOpenWorkspacesRequest),
    ListCookieNames(&'a ListCookieNamesRequest),
    GetCookieValue(&'a GetCookieValueRequest),
    WindowInfo(&'a WindowInfoRequest),
    ErrorResponse(&'a ErrorResponse),
    ReloadResponse(&'a ReloadResponse),
    OtherRequest(&'a InternalEventPayload),
}

impl HostRequest<'_> {
    pub fn type_name(&self) -> String {
        match self {
            HostRequest::ShowToast(_) => "show_toast_request".to_string(),
            HostRequest::CopyText(_) => "copy_text_request".to_string(),
            HostRequest::PromptText(_) => "prompt_text_request".to_string(),
            HostRequest::PromptForm(_) => "prompt_form_request".to_string(),
            HostRequest::RenderGrpcRequest(_) => "render_grpc_request_request".to_string(),
            HostRequest::RenderHttpRequest(_) => "render_http_request_request".to_string(),
            HostRequest::TemplateRender(_) => "template_render_request".to_string(),
            HostRequest::SendHttpRequest(_) => "send_http_request_request".to_string(),
            HostRequest::OpenWindow(_) => "open_window_request".to_string(),
            HostRequest::CloseWindow(_) => "close_window_request".to_string(),
            HostRequest::OpenExternalUrl(_) => "open_external_url_request".to_string(),
            HostRequest::ListOpenWorkspaces(_) => "list_open_workspaces_request".to_string(),
            HostRequest::ListCookieNames(_) => "list_cookie_names_request".to_string(),
            HostRequest::GetCookieValue(_) => "get_cookie_value_request".to_string(),
            HostRequest::WindowInfo(_) => "window_info_request".to_string(),
            HostRequest::ErrorResponse(_) => "error_response".to_string(),
            HostRequest::ReloadResponse(_) => "reload_response".to_string(),
            HostRequest::OtherRequest(payload) => payload.type_name(),
        }
    }
}

impl<'a> From<&'a InternalEventPayload> for GroupedPluginRequest<'a> {
    fn from(payload: &'a InternalEventPayload) -> Self {
        match payload {
            InternalEventPayload::GetKeyValueRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::GetKeyValue(req))
            }
            InternalEventPayload::SetKeyValueRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::SetKeyValue(req))
            }
            InternalEventPayload::DeleteKeyValueRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::DeleteKeyValue(req))
            }
            InternalEventPayload::GetHttpRequestByIdRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::GetHttpRequestById(req))
            }
            InternalEventPayload::ErrorResponse(resp) => {
                GroupedPluginRequest::Host(HostRequest::ErrorResponse(resp))
            }
            InternalEventPayload::ReloadResponse(req) => {
                GroupedPluginRequest::Host(HostRequest::ReloadResponse(req))
            }
            InternalEventPayload::ListOpenWorkspacesRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::ListOpenWorkspaces(req))
            }
            InternalEventPayload::ListFoldersRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::ListFolders(req))
            }
            InternalEventPayload::ListHttpRequestsRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::ListHttpRequests(req))
            }
            InternalEventPayload::ShowToastRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::ShowToast(req))
            }
            InternalEventPayload::CopyTextRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::CopyText(req))
            }
            InternalEventPayload::PromptTextRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::PromptText(req))
            }
            InternalEventPayload::PromptFormRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::PromptForm(req))
            }
            InternalEventPayload::FindHttpResponsesRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::FindHttpResponses(req))
            }
            InternalEventPayload::UpsertModelRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::UpsertModel(req))
            }
            InternalEventPayload::DeleteModelRequest(req) => {
                GroupedPluginRequest::Shared(SharedRequest::DeleteModel(req))
            }
            InternalEventPayload::RenderGrpcRequestRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::RenderGrpcRequest(req))
            }
            InternalEventPayload::RenderHttpRequestRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::RenderHttpRequest(req))
            }
            InternalEventPayload::TemplateRenderRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::TemplateRender(req))
            }
            InternalEventPayload::SendHttpRequestRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::SendHttpRequest(req))
            }
            InternalEventPayload::OpenWindowRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::OpenWindow(req))
            }
            InternalEventPayload::CloseWindowRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::CloseWindow(req))
            }
            InternalEventPayload::OpenExternalUrlRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::OpenExternalUrl(req))
            }
            InternalEventPayload::ListCookieNamesRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::ListCookieNames(req))
            }
            InternalEventPayload::GetCookieValueRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::GetCookieValue(req))
            }
            InternalEventPayload::WindowInfoRequest(req) => {
                GroupedPluginRequest::Host(HostRequest::WindowInfo(req))
            }
            payload if payload.type_name().ends_with("_request") => {
                GroupedPluginRequest::Host(HostRequest::OtherRequest(payload))
            }
            _ => GroupedPluginRequest::Ignore,
        }
    }
}

pub fn handle_shared_plugin_event<'a>(
    query_manager: &QueryManager,
    payload: &'a InternalEventPayload,
    context: SharedPluginEventContext<'_>,
) -> GroupedPluginEvent<'a> {
    match GroupedPluginRequest::from(payload) {
        GroupedPluginRequest::Shared(req) => {
            GroupedPluginEvent::Handled(Some(build_shared_reply(query_manager, req, context)))
        }
        GroupedPluginRequest::Host(req) => GroupedPluginEvent::ToHandle(req),
        GroupedPluginRequest::Ignore => GroupedPluginEvent::Handled(None),
    }
}

fn build_shared_reply(
    query_manager: &QueryManager,
    request: SharedRequest<'_>,
    context: SharedPluginEventContext<'_>,
) -> InternalEventPayload {
    match request {
        SharedRequest::GetKeyValue(req) => {
            let value = query_manager
                .connect()
                .get_plugin_key_value(context.plugin_name, &req.key)
                .map(|v| v.value);
            InternalEventPayload::GetKeyValueResponse(GetKeyValueResponse { value })
        }
        SharedRequest::SetKeyValue(req) => {
            query_manager.connect().set_plugin_key_value(context.plugin_name, &req.key, &req.value);
            InternalEventPayload::SetKeyValueResponse(yaak_plugins::events::SetKeyValueResponse {})
        }
        SharedRequest::DeleteKeyValue(req) => {
            match query_manager.connect().delete_plugin_key_value(context.plugin_name, &req.key) {
                Ok(deleted) => {
                    InternalEventPayload::DeleteKeyValueResponse(DeleteKeyValueResponse { deleted })
                }
                Err(err) => InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: format!("Failed to delete plugin key '{}' : {err}", req.key),
                }),
            }
        }
        SharedRequest::GetHttpRequestById(req) => {
            let http_request = query_manager.connect().get_http_request(&req.id).ok();
            InternalEventPayload::GetHttpRequestByIdResponse(GetHttpRequestByIdResponse {
                http_request,
            })
        }
        SharedRequest::ListFolders(_) => {
            let Some(workspace_id) = context.workspace_id else {
                return InternalEventPayload::ErrorResponse(ErrorResponse {
                    error: "workspace_id is required for list_folders_request".to_string(),
                });
            };
            let folders = match query_manager.connect().list_folders(workspace_id) {
                Ok(folders) => folders,
                Err(err) => {
                    return InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: format!("Failed to list folders: {err}"),
                    });
                }
            };
            InternalEventPayload::ListFoldersResponse(ListFoldersResponse { folders })
        }
        SharedRequest::ListHttpRequests(req) => {
            let http_requests = if let Some(folder_id) = req.folder_id.as_deref() {
                match query_manager.connect().list_http_requests_for_folder_recursive(folder_id) {
                    Ok(http_requests) => http_requests,
                    Err(err) => {
                        return InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to list HTTP requests for folder: {err}"),
                        });
                    }
                }
            } else {
                let Some(workspace_id) = context.workspace_id else {
                    return InternalEventPayload::ErrorResponse(ErrorResponse {
                        error:
                            "workspace_id is required for list_http_requests_request without folder_id"
                                .to_string(),
                    });
                };
                match query_manager.connect().list_http_requests(workspace_id) {
                    Ok(http_requests) => http_requests,
                    Err(err) => {
                        return InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to list HTTP requests: {err}"),
                        });
                    }
                }
            };
            InternalEventPayload::ListHttpRequestsResponse(ListHttpRequestsResponse {
                http_requests,
            })
        }
        SharedRequest::FindHttpResponses(req) => {
            let http_responses = query_manager
                .connect()
                .list_http_responses_for_request(&req.request_id, req.limit.map(|l| l as u64))
                .unwrap_or_default();
            InternalEventPayload::FindHttpResponsesResponse(FindHttpResponsesResponse {
                http_responses,
            })
        }
        SharedRequest::UpsertModel(req) => {
            use AnyModel::*;

            let model = match &req.model {
                HttpRequest(m) => {
                    match query_manager.connect().upsert_http_request(m, &UpdateSource::Plugin) {
                        Ok(model) => HttpRequest(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to upsert HTTP request: {err}"),
                            });
                        }
                    }
                }
                GrpcRequest(m) => {
                    match query_manager.connect().upsert_grpc_request(m, &UpdateSource::Plugin) {
                        Ok(model) => GrpcRequest(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to upsert gRPC request: {err}"),
                            });
                        }
                    }
                }
                WebsocketRequest(m) => {
                    match query_manager.connect().upsert_websocket_request(m, &UpdateSource::Plugin)
                    {
                        Ok(model) => WebsocketRequest(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to upsert WebSocket request: {err}"),
                            });
                        }
                    }
                }
                Folder(m) => {
                    match query_manager.connect().upsert_folder(m, &UpdateSource::Plugin) {
                        Ok(model) => Folder(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to upsert folder: {err}"),
                            });
                        }
                    }
                }
                Environment(m) => {
                    match query_manager.connect().upsert_environment(m, &UpdateSource::Plugin) {
                        Ok(model) => Environment(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to upsert environment: {err}"),
                            });
                        }
                    }
                }
                Workspace(m) => {
                    match query_manager.connect().upsert_workspace(m, &UpdateSource::Plugin) {
                        Ok(model) => Workspace(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to upsert workspace: {err}"),
                            });
                        }
                    }
                }
                _ => {
                    return InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: "Upsert not supported for this model type".to_string(),
                    });
                }
            };

            InternalEventPayload::UpsertModelResponse(UpsertModelResponse { model })
        }
        SharedRequest::DeleteModel(req) => {
            let model = match req.model.as_str() {
                "http_request" => {
                    match query_manager
                        .connect()
                        .delete_http_request_by_id(&req.id, &UpdateSource::Plugin)
                    {
                        Ok(model) => AnyModel::HttpRequest(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to delete HTTP request: {err}"),
                            });
                        }
                    }
                }
                "grpc_request" => {
                    match query_manager
                        .connect()
                        .delete_grpc_request_by_id(&req.id, &UpdateSource::Plugin)
                    {
                        Ok(model) => AnyModel::GrpcRequest(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to delete gRPC request: {err}"),
                            });
                        }
                    }
                }
                "websocket_request" => {
                    match query_manager
                        .connect()
                        .delete_websocket_request_by_id(&req.id, &UpdateSource::Plugin)
                    {
                        Ok(model) => AnyModel::WebsocketRequest(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to delete WebSocket request: {err}"),
                            });
                        }
                    }
                }
                "folder" => match query_manager
                    .connect()
                    .delete_folder_by_id(&req.id, &UpdateSource::Plugin)
                {
                    Ok(model) => AnyModel::Folder(model),
                    Err(err) => {
                        return InternalEventPayload::ErrorResponse(ErrorResponse {
                            error: format!("Failed to delete folder: {err}"),
                        });
                    }
                },
                "environment" => {
                    match query_manager
                        .connect()
                        .delete_environment_by_id(&req.id, &UpdateSource::Plugin)
                    {
                        Ok(model) => AnyModel::Environment(model),
                        Err(err) => {
                            return InternalEventPayload::ErrorResponse(ErrorResponse {
                                error: format!("Failed to delete environment: {err}"),
                            });
                        }
                    }
                }
                _ => {
                    return InternalEventPayload::ErrorResponse(ErrorResponse {
                        error: "Delete not supported for this model type".to_string(),
                    });
                }
            };

            InternalEventPayload::DeleteModelResponse(DeleteModelResponse { model })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use yaak_models::models::{AnyModel, Folder, HttpRequest, Workspace};
    use yaak_models::util::UpdateSource;

    fn seed_query_manager() -> (QueryManager, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let db_path = temp_dir.path().join("db.sqlite");
        let blob_path = temp_dir.path().join("blobs.sqlite");
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize DB");

        query_manager
            .connect()
            .upsert_workspace(
                &Workspace {
                    id: "wk_test".to_string(),
                    name: "Workspace".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )
            .expect("Failed to seed workspace");

        query_manager
            .connect()
            .upsert_folder(
                &Folder {
                    id: "fl_test".to_string(),
                    workspace_id: "wk_test".to_string(),
                    name: "Folder".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )
            .expect("Failed to seed folder");

        query_manager
            .connect()
            .upsert_http_request(
                &HttpRequest {
                    id: "rq_test".to_string(),
                    workspace_id: "wk_test".to_string(),
                    folder_id: Some("fl_test".to_string()),
                    name: "Request".to_string(),
                    method: "GET".to_string(),
                    url: "https://example.com".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )
            .expect("Failed to seed request");

        (query_manager, temp_dir)
    }

    #[test]
    fn list_requests_requires_workspace_when_folder_missing() {
        let (query_manager, _temp_dir) = seed_query_manager();
        let payload = InternalEventPayload::ListHttpRequestsRequest(
            yaak_plugins::events::ListHttpRequestsRequest { folder_id: None },
        );
        let result = handle_shared_plugin_event(
            &query_manager,
            &payload,
            SharedPluginEventContext { plugin_name: "@yaak/test", workspace_id: None },
        );

        assert!(matches!(
            result,
            GroupedPluginEvent::Handled(Some(InternalEventPayload::ErrorResponse(_)))
        ));
    }

    #[test]
    fn list_requests_by_workspace_and_folder() {
        let (query_manager, _temp_dir) = seed_query_manager();

        let by_workspace_payload = InternalEventPayload::ListHttpRequestsRequest(
            yaak_plugins::events::ListHttpRequestsRequest { folder_id: None },
        );
        let by_workspace = handle_shared_plugin_event(
            &query_manager,
            &by_workspace_payload,
            SharedPluginEventContext { plugin_name: "@yaak/test", workspace_id: Some("wk_test") },
        );
        match by_workspace {
            GroupedPluginEvent::Handled(Some(InternalEventPayload::ListHttpRequestsResponse(
                resp,
            ))) => {
                assert_eq!(resp.http_requests.len(), 1);
            }
            other => panic!("unexpected workspace response: {other:?}"),
        }

        let by_folder_payload = InternalEventPayload::ListHttpRequestsRequest(
            yaak_plugins::events::ListHttpRequestsRequest {
                folder_id: Some("fl_test".to_string()),
            },
        );
        let by_folder = handle_shared_plugin_event(
            &query_manager,
            &by_folder_payload,
            SharedPluginEventContext { plugin_name: "@yaak/test", workspace_id: None },
        );
        match by_folder {
            GroupedPluginEvent::Handled(Some(InternalEventPayload::ListHttpRequestsResponse(
                resp,
            ))) => {
                assert_eq!(resp.http_requests.len(), 1);
            }
            other => panic!("unexpected folder response: {other:?}"),
        }
    }

    #[test]
    fn find_http_responses_is_shared_handled() {
        let (query_manager, _temp_dir) = seed_query_manager();
        let payload = InternalEventPayload::FindHttpResponsesRequest(FindHttpResponsesRequest {
            request_id: "rq_test".to_string(),
            limit: Some(1),
        });

        let result = handle_shared_plugin_event(
            &query_manager,
            &payload,
            SharedPluginEventContext { plugin_name: "@yaak/test", workspace_id: Some("wk_test") },
        );

        match result {
            GroupedPluginEvent::Handled(Some(InternalEventPayload::FindHttpResponsesResponse(
                resp,
            ))) => {
                assert!(resp.http_responses.is_empty());
            }
            other => panic!("unexpected find responses result: {other:?}"),
        }
    }

    #[test]
    fn upsert_and_delete_model_are_shared_handled() {
        let (query_manager, _temp_dir) = seed_query_manager();

        let existing = query_manager
            .connect()
            .get_http_request("rq_test")
            .expect("Failed to load seeded request");
        let upsert_payload = InternalEventPayload::UpsertModelRequest(UpsertModelRequest {
            model: AnyModel::HttpRequest(HttpRequest {
                name: "Request Updated".to_string(),
                ..existing
            }),
        });

        let upsert_result = handle_shared_plugin_event(
            &query_manager,
            &upsert_payload,
            SharedPluginEventContext { plugin_name: "@yaak/test", workspace_id: Some("wk_test") },
        );
        match upsert_result {
            GroupedPluginEvent::Handled(Some(InternalEventPayload::UpsertModelResponse(resp))) => {
                match resp.model {
                    AnyModel::HttpRequest(r) => assert_eq!(r.name, "Request Updated"),
                    other => panic!("unexpected upsert model type: {other:?}"),
                }
            }
            other => panic!("unexpected upsert result: {other:?}"),
        }

        let delete_payload = InternalEventPayload::DeleteModelRequest(DeleteModelRequest {
            model: "http_request".to_string(),
            id: "rq_test".to_string(),
        });
        let delete_result = handle_shared_plugin_event(
            &query_manager,
            &delete_payload,
            SharedPluginEventContext { plugin_name: "@yaak/test", workspace_id: Some("wk_test") },
        );
        match delete_result {
            GroupedPluginEvent::Handled(Some(InternalEventPayload::DeleteModelResponse(resp))) => {
                match resp.model {
                    AnyModel::HttpRequest(r) => assert_eq!(r.id, "rq_test"),
                    other => panic!("unexpected delete model type: {other:?}"),
                }
            }
            other => panic!("unexpected delete result: {other:?}"),
        }
    }

    #[test]
    fn host_request_classification_works() {
        let (query_manager, _temp_dir) = seed_query_manager();
        let payload = InternalEventPayload::WindowInfoRequest(WindowInfoRequest {
            label: "main".to_string(),
        });
        let result = handle_shared_plugin_event(
            &query_manager,
            &payload,
            SharedPluginEventContext { plugin_name: "@yaak/test", workspace_id: None },
        );

        match result {
            GroupedPluginEvent::ToHandle(HostRequest::WindowInfo(req)) => {
                assert_eq!(req.label, "main")
            }
            other => panic!("unexpected host classification: {other:?}"),
        }
    }
}
