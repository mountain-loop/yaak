use chrono::NaiveDateTime;
use rusqlite::Row;
use sea_query::Order::Desc;
use sea_query::{IntoColumnRef, IntoIden, IntoTableRef, Order, SimpleExpr, enum_def};
use serde::{Deserialize, Serialize};
use yaak_database::{
    UpsertModelInfo, UpdateSource, Result as DbResult,
    generate_prefixed_id, upsert_date,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HttpResponseState {
    Initialized,
    Connected,
    Closed,
}

impl Default for HttpResponseState {
    fn default() -> Self {
        Self::Initialized
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponseHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
#[enum_def(table_name = "proxy_http_responses")]
pub struct HttpResponse {
    pub model: String,
    pub id: String,
    pub proxy_request_id: i64,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub elapsed: i32,
    pub elapsed_headers: i32,
    pub elapsed_dns: i32,
    pub status: i32,
    pub status_reason: Option<String>,
    pub url: String,
    pub headers: Vec<HttpResponseHeader>,
    pub request_headers: Vec<HttpResponseHeader>,
    pub error: Option<String>,
    pub body_path: Option<String>,
    pub content_length: Option<i32>,
    pub content_length_compressed: Option<i32>,
    pub request_content_length: Option<i32>,
    pub remote_addr: Option<String>,
    pub version: Option<String>,
    pub state: HttpResponseState,
}

impl UpsertModelInfo for HttpResponse {
    fn table_name() -> impl IntoTableRef + IntoIden {
        HttpResponseIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        HttpResponseIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("rs")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (HttpResponseIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> DbResult<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use HttpResponseIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (ProxyRequestId, self.proxy_request_id.into()),
            (BodyPath, self.body_path.into()),
            (ContentLength, self.content_length.into()),
            (ContentLengthCompressed, self.content_length_compressed.into()),
            (Elapsed, self.elapsed.into()),
            (ElapsedHeaders, self.elapsed_headers.into()),
            (ElapsedDns, self.elapsed_dns.into()),
            (Error, self.error.into()),
            (Headers, serde_json::to_string(&self.headers)?.into()),
            (RemoteAddr, self.remote_addr.into()),
            (RequestContentLength, self.request_content_length.into()),
            (RequestHeaders, serde_json::to_string(&self.request_headers)?.into()),
            (State, serde_json::to_value(&self.state)?.as_str().into()),
            (Status, self.status.into()),
            (StatusReason, self.status_reason.into()),
            (Url, self.url.into()),
            (Version, self.version.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            HttpResponseIden::UpdatedAt,
            HttpResponseIden::BodyPath,
            HttpResponseIden::ContentLength,
            HttpResponseIden::ContentLengthCompressed,
            HttpResponseIden::Elapsed,
            HttpResponseIden::ElapsedHeaders,
            HttpResponseIden::ElapsedDns,
            HttpResponseIden::Error,
            HttpResponseIden::Headers,
            HttpResponseIden::RemoteAddr,
            HttpResponseIden::RequestContentLength,
            HttpResponseIden::RequestHeaders,
            HttpResponseIden::State,
            HttpResponseIden::Status,
            HttpResponseIden::StatusReason,
            HttpResponseIden::Url,
            HttpResponseIden::Version,
        ]
    }

    fn from_row(r: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let headers: String = r.get("headers")?;
        let request_headers: String = r.get("request_headers")?;
        let state: String = r.get("state")?;
        Ok(Self {
            id: r.get("id")?,
            model: r.get("model")?,
            proxy_request_id: r.get("proxy_request_id")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            error: r.get("error")?,
            url: r.get("url")?,
            content_length: r.get("content_length")?,
            content_length_compressed: r.get("content_length_compressed").unwrap_or_default(),
            version: r.get("version")?,
            elapsed: r.get("elapsed")?,
            elapsed_headers: r.get("elapsed_headers")?,
            elapsed_dns: r.get("elapsed_dns").unwrap_or_default(),
            remote_addr: r.get("remote_addr")?,
            status: r.get("status")?,
            status_reason: r.get("status_reason")?,
            state: serde_json::from_str(format!(r#""{state}""#).as_str()).unwrap_or_default(),
            body_path: r.get("body_path")?,
            headers: serde_json::from_str(headers.as_str()).unwrap_or_default(),
            request_content_length: r.get("request_content_length").unwrap_or_default(),
            request_headers: serde_json::from_str(request_headers.as_str()).unwrap_or_default(),
        })
    }
}
