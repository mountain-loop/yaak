use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{HttpRequest, HttpRequestIden::*, ModelType};
use crate::queries::{generate_model_id, upsert_date, UpdateSource};

impl<'a> DbContext<'a> {
    pub fn get_http_request(&self, id: &str) -> Result<Option<HttpRequest>> {
        Ok(self.find_optional(Table, Id, id)?)
    }

    pub fn list_http_requests(&self, workspace_id: &str) -> Result<Vec<HttpRequest>> {
        Ok(self.find_many(Table, WorkspaceId, workspace_id, None)?)
    }

    pub fn delete_http_request(
        &self,
        id: &str,
        update_source: &UpdateSource,
    ) -> Result<HttpRequest> {
        // DB deletes will cascade but this will delete the files
        self.delete_all_http_responses_for_request(id, update_source)?;
        Ok(self.delete_one(Table, Id, id, update_source)?)
    }

    pub fn upsert_http_request(
        &self,
        m: HttpRequest,
        update_source: &UpdateSource,
    ) -> Result<HttpRequest> {
        self.upsert_one(
            Table,
            Id,
            &m.id,
            || generate_model_id(ModelType::TypeHttpRequest),
            vec![
                (CreatedAt, upsert_date(update_source, m.created_at)),
                (UpdatedAt, upsert_date(update_source, m.updated_at)),
                (WorkspaceId, m.workspace_id.into()),
                (FolderId, m.folder_id.into()),
                (Name, m.name.trim().into()),
                (Description, m.description.into()),
                (Url, m.url.into()),
                (UrlParameters, serde_json::to_string(&m.url_parameters)?.into()),
                (Method, m.method.into()),
                (Body, serde_json::to_string(&m.body)?.into()),
                (BodyType, m.body_type.into()),
                (Authentication, serde_json::to_string(&m.authentication)?.into()),
                (AuthenticationType, m.authentication_type.into()),
                (Headers, serde_json::to_string(&m.headers)?.into()),
                (SortPriority, m.sort_priority.into()),
            ],
            vec![
                UpdatedAt,
                WorkspaceId,
                Name,
                Description,
                FolderId,
                Method,
                Headers,
                Body,
                BodyType,
                Authentication,
                AuthenticationType,
                Url,
                UrlParameters,
                SortPriority,
            ],
            update_source,
        )
    }
}
