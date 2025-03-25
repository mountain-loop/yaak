use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{HttpRequest, HttpRequestIden};
use crate::queries_legacy::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_http_request(&self, id: &str) -> Result<Option<HttpRequest>> {
        self.find_optional(HttpRequestIden::Id, id)
    }

    pub fn list_http_requests(&self, workspace_id: &str) -> Result<Vec<HttpRequest>> {
        self.find_many(HttpRequestIden::WorkspaceId, workspace_id, None)
    }

    pub fn delete_http_request(
        &self,
        m: &HttpRequest,
        source: &UpdateSource,
    ) -> Result<HttpRequest> {
        self.delete_all_http_responses_for_request(m.id.as_str(), source)?;
        self.delete(m, source)
    }

    pub fn delete_http_request_by_id(
        &self,
        id: &str,
        source: &UpdateSource,
    ) -> Result<HttpRequest> {
        let http_request = self.get_http_request(id)?.unwrap();
        self.delete_http_request(&http_request, source)
    }

    pub fn duplicate_http_request(
        &self,
        http_request: &HttpRequest,
        source: &UpdateSource,
    ) -> Result<HttpRequest> {
        let mut http_request = http_request.clone();
        http_request.id = "".to_string();
        http_request.sort_priority = http_request.sort_priority + 0.001;
        self.upsert(&http_request, source)
    }

    pub fn upsert_http_request(
        &self,
        http_request: &HttpRequest,
        source: &UpdateSource,
    ) -> Result<HttpRequest> {
        self.upsert(http_request, source)
    }
}
