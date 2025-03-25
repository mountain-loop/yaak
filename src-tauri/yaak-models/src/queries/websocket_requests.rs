use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{WebsocketRequest, WebsocketRequestIden};
use crate::queries_legacy::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_websocket_request(&self, id: &str) -> Result<Option<WebsocketRequest>> {
        self.find_optional(WebsocketRequestIden::Id, id)
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
        let request = self.get_websocket_request(id)?.unwrap();
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
}
