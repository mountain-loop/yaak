use super::dedupe_headers;
use crate::client_db::ClientDb;
use crate::error::Result;
use crate::models::{
    AnyModel, Folder, FolderIden, HttpRequestHeader, ResolvedHttpRequestSettings, ResolvedSetting,
    WebsocketRequest, WebsocketRequestIden,
};
use crate::util::UpdateSource;
use serde_json::Value;
use std::collections::BTreeMap;

impl<'a> ClientDb<'a> {
    pub fn get_websocket_request(&self, id: &str) -> Result<WebsocketRequest> {
        self.find_one(WebsocketRequestIden::Id, id)
    }

    pub fn list_websocket_requests(&self, workspace_id: &str) -> Result<Vec<WebsocketRequest>> {
        self.find_many(WebsocketRequestIden::WorkspaceId, workspace_id, None)
    }

    pub fn list_websocket_requests_for_folder_recursive(
        &self,
        folder_id: &str,
    ) -> Result<Vec<WebsocketRequest>> {
        let mut children = Vec::new();
        for folder in self.find_many::<Folder>(FolderIden::FolderId, folder_id, None)? {
            children.extend(self.list_websocket_requests_for_folder_recursive(&folder.id)?);
        }
        for request in
            self.find_many::<WebsocketRequest>(WebsocketRequestIden::FolderId, folder_id, None)?
        {
            children.push(request);
        }
        Ok(children)
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
    ) -> Result<(Option<String>, BTreeMap<String, Value>, String)> {
        if let Some(at) = websocket_request.authentication_type.clone() {
            return Ok((
                Some(at),
                websocket_request.authentication.clone(),
                websocket_request.id.clone(),
            ));
        }

        if let Some(folder_id) = websocket_request.folder_id.clone() {
            let folder = self.get_folder(&folder_id)?;
            return self.resolve_auth_for_folder(&folder);
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

        Ok(dedupe_headers(headers))
    }

    pub fn resolve_settings_for_websocket_request(
        &self,
        websocket_request: &WebsocketRequest,
    ) -> Result<ResolvedHttpRequestSettings> {
        let parent = if let Some(folder_id) = websocket_request.folder_id.clone() {
            let folder = self.get_folder(&folder_id)?;
            self.resolve_settings_for_folder(&folder)?
        } else {
            let workspace = self.get_workspace(&websocket_request.workspace_id)?;
            self.resolve_settings_for_workspace(&workspace)
        };

        Ok(ResolvedHttpRequestSettings {
            validate_certificates: if websocket_request.setting_validate_certificates.enabled {
                ResolvedSetting::from_model(
                    websocket_request.setting_validate_certificates.value,
                    AnyModel::WebsocketRequest(websocket_request.clone()),
                )
            } else {
                parent.validate_certificates
            },
            send_cookies: if websocket_request.setting_send_cookies.enabled {
                ResolvedSetting::from_model(
                    websocket_request.setting_send_cookies.value,
                    AnyModel::WebsocketRequest(websocket_request.clone()),
                )
            } else {
                parent.send_cookies
            },
            store_cookies: if websocket_request.setting_store_cookies.enabled {
                ResolvedSetting::from_model(
                    websocket_request.setting_store_cookies.value,
                    AnyModel::WebsocketRequest(websocket_request.clone()),
                )
            } else {
                parent.store_cookies
            },
            ..parent
        })
    }
}
