use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{HttpResponse, HttpResponseIden::*};
use crate::queries::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn list_http_responses_for_request(
        &self,
        request_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<HttpResponse>> {
        self.find_many(Table, RequestId, request_id, limit)
    }

    pub fn delete_all_http_responses_for_request(
        &self,
        request_id: &str,
        update_source: &UpdateSource,
    ) -> Result<()> {
        let responses = self.list_http_responses_for_request(request_id, None)?;
        for m in responses {
            self.delete_one::<HttpResponse>(Table, Id, &m.id, update_source)?;
        }
        Ok(())
    }
}
