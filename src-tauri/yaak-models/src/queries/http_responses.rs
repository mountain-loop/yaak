use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{HttpResponse, HttpResponseIden::*};
use crate::queries_legacy::{UpdateSource, MAX_HISTORY_ITEMS};
use log::{debug, error};
use std::fs;

impl<'a> DbContext<'a> {
    pub fn get_http_response(&self, id: &str) -> Result<HttpResponse> {
        self.find_one(Id, id)
    }

    pub fn list_http_responses_for_request(
        &self,
        request_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<HttpResponse>> {
        self.find_many(RequestId, request_id, limit)
    }

    pub fn list_http_responses_for_workspace(
        &self,
        workspace_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<HttpResponse>> {
        self.find_many(WorkspaceId, workspace_id, limit)
    }

    pub fn delete_all_http_responses_for_request(
        &self,
        request_id: &str,
        source: &UpdateSource,
    ) -> Result<()> {
        let responses = self.list_http_responses_for_request(request_id, None)?;
        for m in responses {
            self.delete(&m, source)?;
        }
        Ok(())
    }

    pub fn delete_all_http_responses_for_workspace(
        &self,
        workspace_id: &str,
        source: &UpdateSource,
    ) -> Result<()> {
        let responses = self.find_many::<HttpResponse>(WorkspaceId, workspace_id, None)?;
        for m in responses {
            self.delete(&m, source)?;
        }
        Ok(())
    }

    pub fn delete_http_response(
        &self,
        http_response: &HttpResponse,
        source: &UpdateSource,
    ) -> Result<HttpResponse> {
        // Delete the body file if it exists
        if let Some(p) = http_response.body_path.clone() {
            if let Err(e) = fs::remove_file(p) {
                error!("Failed to delete body file: {}", e);
            };
        }

        Ok(self.delete(http_response, source)?)
    }

    pub fn upsert_http_response(
        &self,
        http_response: &HttpResponse,
        source: &UpdateSource,
    ) -> Result<HttpResponse> {
        let responses = self.find_many(RequestId, http_response.request_id.as_str(), None)?;

        for m in responses.iter().skip(MAX_HISTORY_ITEMS - 1) {
            debug!("Deleting old HTTP response {}", http_response.id);
            self.delete_http_response(&m, source)?;
        }

        self.upsert(http_response, source)
    }
}
