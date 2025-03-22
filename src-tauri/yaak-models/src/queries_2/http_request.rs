use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{AnyModel, GrpcEventIden, HttpRequest, HttpRequestIden, ModelType};
use crate::queries::{generate_model_id, ModelPayload, UpdateSource};
use sea_query::{OnConflict, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;

impl<'a> DbContext<'a> {
    pub fn get_http_request(&self, id: &str) -> Result<Option<HttpRequest>> {
        Ok(self.get_where_optional(HttpRequestIden::Table, HttpRequestIden::Id, id)?)
    }

    pub fn list_http_requests(&self, workspace_id: &str) -> Result<Vec<HttpRequest>> {
        Ok(self.list_where(HttpRequestIden::Table, HttpRequestIden::WorkspaceId, workspace_id)?)
    }

    pub fn upsert_http_request(
        &self,
        request: HttpRequest,
        update_source: &UpdateSource,
    ) -> Result<HttpRequest> {
        let id = match request.id.as_str() {
            "" => generate_model_id(ModelType::TypeHttpRequest),
            _ => request.id.to_string(),
        };
        let trimmed_name = request.name.trim();

        let (sql, params) = Query::insert()
            .into_table(HttpRequestIden::Table)
            .columns([
                HttpRequestIden::Id,
                HttpRequestIden::CreatedAt,
                HttpRequestIden::UpdatedAt,
                HttpRequestIden::WorkspaceId,
                HttpRequestIden::FolderId,
                HttpRequestIden::Name,
                HttpRequestIden::Description,
                HttpRequestIden::Url,
                HttpRequestIden::UrlParameters,
                HttpRequestIden::Method,
                HttpRequestIden::Body,
                HttpRequestIden::BodyType,
                HttpRequestIden::Authentication,
                HttpRequestIden::AuthenticationType,
                HttpRequestIden::Headers,
                HttpRequestIden::SortPriority,
            ])
            .values_panic([
                id.as_str().into(),
                crate::queries::timestamp_for_upsert(update_source, request.created_at).into(),
                crate::queries::timestamp_for_upsert(update_source, request.updated_at).into(),
                request.workspace_id.into(),
                request.folder_id.as_ref().map(|s| s.as_str()).into(),
                trimmed_name.into(),
                request.description.into(),
                request.url.into(),
                serde_json::to_string(&request.url_parameters)?.into(),
                request.method.into(),
                serde_json::to_string(&request.body)?.into(),
                request.body_type.as_ref().map(|s| s.as_str()).into(),
                serde_json::to_string(&request.authentication)?.into(),
                request.authentication_type.as_ref().map(|s| s.as_str()).into(),
                serde_json::to_string(&request.headers)?.into(),
                request.sort_priority.into(),
            ])
            .on_conflict(
                OnConflict::column(GrpcEventIden::Id)
                    .update_columns([
                        HttpRequestIden::UpdatedAt,
                        HttpRequestIden::WorkspaceId,
                        HttpRequestIden::Name,
                        HttpRequestIden::Description,
                        HttpRequestIden::FolderId,
                        HttpRequestIden::Method,
                        HttpRequestIden::Headers,
                        HttpRequestIden::Body,
                        HttpRequestIden::BodyType,
                        HttpRequestIden::Authentication,
                        HttpRequestIden::AuthenticationType,
                        HttpRequestIden::Url,
                        HttpRequestIden::UrlParameters,
                        HttpRequestIden::SortPriority,
                    ])
                    .to_owned(),
            )
            .returning_all()
            .build_rusqlite(SqliteQueryBuilder);

        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let m: HttpRequest = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
        self.tx
            .send(ModelPayload {
                model: AnyModel::HttpRequest(m.to_owned()),
                update_source: update_source.clone(),
            })
            .unwrap();
        Ok(m)
    }
}
