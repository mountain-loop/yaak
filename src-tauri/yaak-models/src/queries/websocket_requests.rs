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
        m: &WebsocketRequest,
        source: &UpdateSource,
    ) -> Result<WebsocketRequest> {
        self.delete_all_websocket_connections_for_request(m.id.as_str(), source)?;
        self.delete(m, source)
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
        let mut request = websocket_request.clone();
        request.id = "".to_string();
        request.sort_priority = request.sort_priority + 0.001;
        self.upsert(&request, source)
    }

    pub fn upsert_websocket_request(
        &self,
        websocket_request: &WebsocketRequest,
        source: &UpdateSource,
    ) -> Result<WebsocketRequest> {
        self.upsert(websocket_request, source)
    }
}
