use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{
    WebsocketEvent,
    WebsocketEventIden,
};
use crate::queries_legacy::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_websocket_event(&self, id: &str) -> Result<WebsocketEvent> {
        self.find_one(WebsocketEventIden::Id, id)
    }

    pub fn list_websocket_events(&self, connection_id: &str) -> Result<Vec<WebsocketEvent>> {
        self.find_many(WebsocketEventIden::ConnectionId, connection_id, None)
    }

    pub fn upsert_websocket_event(
        &self,
        websocket_event: &WebsocketEvent,
        source: &UpdateSource,
    ) -> Result<WebsocketEvent> {
        self.upsert(websocket_event, source)
    }
}
