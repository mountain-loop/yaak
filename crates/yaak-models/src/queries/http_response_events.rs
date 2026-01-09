use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{HttpResponseEvent, HttpResponseEventIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn list_http_response_events(&self, response_id: &str) -> Result<Vec<HttpResponseEvent>> {
        self.find_many(HttpResponseEventIden::ResponseId, response_id, None)
    }

    pub fn upsert_http_response_event(
        &self,
        http_response_event: &HttpResponseEvent,
        source: &UpdateSource,
    ) -> Result<HttpResponseEvent> {
        self.upsert(http_response_event, source)
    }
}
