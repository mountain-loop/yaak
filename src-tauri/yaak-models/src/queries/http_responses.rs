use crate::error::Result;
use crate::models::{HttpResponse, HttpResponseIden, HttpResponseState};
use crate::util::UpdateSource;
use log::{debug, error};
use sea_query::{Expr, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use std::fs;
use crate::db_context::DbContext;
use crate::queries::MAX_HISTORY_ITEMS;

impl<'a> DbContext<'a> {
    pub fn get_http_response(&self, id: &str) -> Result<HttpResponse> {
        self.find_one(HttpResponseIden::Id, id)
    }

    pub fn list_http_responses_for_request(
        &self,
        request_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<HttpResponse>> {
        self.find_many(HttpResponseIden::RequestId, request_id, limit)
    }

    pub fn list_http_responses(
        &self,
        workspace_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<HttpResponse>> {
        self.find_many(HttpResponseIden::WorkspaceId, workspace_id, limit)
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
        let responses =
            self.find_many::<HttpResponse>(HttpResponseIden::WorkspaceId, workspace_id, None)?;
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
        let responses = self.list_http_responses_for_request(&http_response.request_id, None)?;

        for m in responses.iter().skip(MAX_HISTORY_ITEMS - 1) {
            debug!("Deleting old HTTP response {}", http_response.id);
            self.delete_http_response(&m, source)?;
        }

        self.upsert(http_response, source)
    }

    pub fn cancel_pending_http_responses(&self) -> Result<()> {
        let closed = serde_json::to_value(&HttpResponseState::Closed)?;
        let (sql, params) = Query::update()
            .table(HttpResponseIden::Table)
            .values([(HttpResponseIden::State, closed.as_str().into())])
            .cond_where(Expr::col(HttpResponseIden::State).ne(closed.as_str()))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str())?;
        stmt.execute(&*params.as_params())?;
        Ok(())
    }

    pub fn update_http_response_if_id(
        &self,
        response: &HttpResponse,
        source: &UpdateSource,
    ) -> Result<HttpResponse> {
        if response.id.is_empty() {
            Ok(response.clone())
        } else {
            self.upsert(response, source)
        }
    }
}
