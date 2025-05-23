use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{HttpRequestHeader, WebsocketRequest, WebsocketRequestIden};
use crate::util::UpdateSource;
use serde_json::Value;
use std::collections::BTreeMap;

impl<'a> DbContext<'a> {
    pub fn get_websocket_request(&self, id: &str) -> Result<WebsocketRequest> {
        self.find_one(WebsocketRequestIden::Id, id)
    }

    pub fn list_websocket_requests(&self, workspace_id: &str) -> Result<Vec<WebsocketRequest>> {
        self.find_many(WebsocketRequestIden::WorkspaceId, workspace_id, None)
    }

    pub fn delete_websocket_request(
        &self,
        websocket_request: &WebsocketRequest,
        source: &UpdateSource,
    ) -> Result<WebsocketRequest> {
        self.delete_all_websocket_connections_for_request(websocket_request.id.as_str(), source)?;
        self.delete(websocket_request, source)
    }

    pub fn delete_websocket_request_by_id(
        &self,
        id: &str,
        source: &UpdateSource,
    ) -> Result<WebsocketRequest> {
        let request = self.get_websocket_request(id)?;
        self.delete_websocket_request(&request, source)
    }

    pub fn duplicate_websocket_request(
        &self,
        websocket_request: &WebsocketRequest,
        source: &UpdateSource,
    ) -> Result<WebsocketRequest> {
        let mut websocket_request = websocket_request.clone();
        websocket_request.id = "".to_string();
        websocket_request.sort_priority = websocket_request.sort_priority + 0.001;
        self.upsert(&websocket_request, source)
    }

    pub fn upsert_websocket_request(
        &self,
        websocket_request: &WebsocketRequest,
        source: &UpdateSource,
    ) -> Result<WebsocketRequest> {
        self.upsert(websocket_request, source)
    }

    pub fn resolve_auth_for_websocket_request(
        &self,
        websocket_request: &WebsocketRequest,
    ) -> Result<(Option<String>, BTreeMap<String, Value>)> {
        if let Some(at) = websocket_request.authentication_type.clone() {
            return Ok((Some(at), websocket_request.authentication.clone()));
        }

        if let Some(folder_id) = websocket_request.folder_id.clone() {
            let folder = self.get_folder(&folder_id)?;
            return self.resolve_auth_for_folder(folder);
        }

        let workspace = self.get_workspace(&websocket_request.workspace_id)?;
        Ok(self.resolve_auth_for_workspace(&workspace))
    }

    pub fn resolve_headers_for_websocket_request(
        &self,
        websocket_request: &WebsocketRequest,
    ) -> Result<Vec<HttpRequestHeader>> {
        let workspace = self.get_workspace(&websocket_request.workspace_id)?;

        // Resolved headers should be from furthest to closest ancestor, to override logically.
        let mut headers = Vec::new();

        headers.append(&mut workspace.headers.clone());

        if let Some(folder_id) = websocket_request.folder_id.clone() {
            let parent_folder = self.get_folder(&folder_id)?;
            let mut folder_headers = self.resolve_headers_for_folder(&parent_folder)?;
            headers.append(&mut folder_headers);
        } else {
            let workspace = self.get_workspace(&websocket_request.workspace_id)?;
            let mut workspace_headers = self.resolve_headers_for_workspace(&workspace);
            headers.append(&mut workspace_headers);
        }

        headers.append(&mut websocket_request.headers.clone());

        Ok(headers)
    }
}
