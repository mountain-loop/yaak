use chrono::NaiveDateTime;
use rusqlite::Row;
use sea_query::{IntoColumnRef, IntoIden, IntoTableRef, Order, SimpleExpr, enum_def};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_database::{
    ModelChangeEvent, Result as DbResult, UpdateSource, UpsertModelInfo, generate_prefixed_id,
    upsert_date,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ProxyHeader {
    pub name: String,
    pub value: String,
}

/// One proxied request and its response. The bodies are in `blobs.sqlite`, not the row.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "flows")]
pub struct Flow {
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub started_at: NaiveDateTime,
    pub method: String,
    pub url: String,
    /// Version spoken by the client.
    pub client_http_version: String,
    /// Version spoken with the upstream server.
    pub upstream_http_version: Option<String>,
    pub remote_addr: Option<String>,
    pub status: Option<i32>,
    /// The response's Content-Type.
    pub content_type: Option<String>,
    pub request_headers: Vec<ProxyHeader>,
    pub response_headers: Vec<ProxyHeader>,
    /// Bytes of the request body on the wire, captured or not.
    #[ts(type = "number")]
    pub request_size: i64,
    /// Bytes of the response body on the wire, captured or not.
    #[ts(type = "number")]
    pub response_size: i64,
    /// Only the first `capture_body_limit` bytes of the body are stored.
    pub request_truncated: bool,
    /// Only the first `capture_body_limit` bytes of the body are stored.
    pub response_truncated: bool,
    /// Milliseconds from `started_at` to the response headers.
    pub elapsed_headers_ms: Option<i32>,
    /// Milliseconds from `started_at` to the end of the response.
    pub elapsed_ms: Option<i32>,
    pub error: Option<String>,
    /// The id of the Yaak request this flow was last saved as.
    pub saved_request_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum FlowBody {
    Request,
    Response,
}

impl Flow {
    /// The blob store id of one of a flow's bodies.
    pub fn body_id(flow_id: &str, body: FlowBody) -> String {
        match body {
            FlowBody::Request => format!("{flow_id}.request"),
            FlowBody::Response => format!("{flow_id}.response"),
        }
    }

    pub fn headers(&self, body: FlowBody) -> &[ProxyHeader] {
        match body {
            FlowBody::Request => &self.request_headers,
            FlowBody::Response => &self.response_headers,
        }
    }

    pub fn truncated(&self, body: FlowBody) -> bool {
        match body {
            FlowBody::Request => self.request_truncated,
            FlowBody::Response => self.response_truncated,
        }
    }
}

pub fn find_header<'a>(headers: &'a [ProxyHeader], name: &str) -> Option<&'a str> {
    headers.iter().find(|h| h.name.eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ModelPayload {
    pub model: Flow,
    pub change: ModelChangeEvent,
}

impl UpsertModelInfo for Flow {
    fn table_name() -> impl IntoTableRef + IntoIden {
        FlowIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        FlowIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("fl")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (FlowIden::StartedAt, Order::Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> DbResult<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use FlowIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (StartedAt, self.started_at.into()),
            (Method, self.method.into()),
            (Url, self.url.into()),
            (ClientHttpVersion, self.client_http_version.into()),
            (UpstreamHttpVersion, self.upstream_http_version.into()),
            (RemoteAddr, self.remote_addr.into()),
            (Status, self.status.into()),
            (ContentType, self.content_type.into()),
            (RequestHeaders, serde_json::to_string(&self.request_headers)?.into()),
            (ResponseHeaders, serde_json::to_string(&self.response_headers)?.into()),
            (RequestSize, self.request_size.into()),
            (ResponseSize, self.response_size.into()),
            (RequestTruncated, self.request_truncated.into()),
            (ResponseTruncated, self.response_truncated.into()),
            (ElapsedHeadersMs, self.elapsed_headers_ms.into()),
            (ElapsedMs, self.elapsed_ms.into()),
            (Error, self.error.into()),
            (SavedRequestId, self.saved_request_id.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            FlowIden::UpdatedAt,
            FlowIden::StartedAt,
            FlowIden::Method,
            FlowIden::Url,
            FlowIden::ClientHttpVersion,
            FlowIden::UpstreamHttpVersion,
            FlowIden::RemoteAddr,
            FlowIden::Status,
            FlowIden::ContentType,
            FlowIden::RequestHeaders,
            FlowIden::ResponseHeaders,
            FlowIden::RequestSize,
            FlowIden::ResponseSize,
            FlowIden::RequestTruncated,
            FlowIden::ResponseTruncated,
            FlowIden::ElapsedHeadersMs,
            FlowIden::ElapsedMs,
            FlowIden::Error,
            FlowIden::SavedRequestId,
        ]
    }

    fn from_row(r: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let request_headers: String = r.get("request_headers")?;
        let response_headers: String = r.get("response_headers")?;
        Ok(Self {
            id: r.get("id")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            started_at: r.get("started_at")?,
            method: r.get("method")?,
            url: r.get("url")?,
            client_http_version: r.get("client_http_version")?,
            upstream_http_version: r.get("upstream_http_version")?,
            remote_addr: r.get("remote_addr")?,
            status: r.get("status")?,
            content_type: r.get("content_type")?,
            request_headers: serde_json::from_str(&request_headers).unwrap_or_default(),
            response_headers: serde_json::from_str(&response_headers).unwrap_or_default(),
            request_size: r.get("request_size")?,
            response_size: r.get("response_size")?,
            request_truncated: r.get("request_truncated")?,
            response_truncated: r.get("response_truncated")?,
            elapsed_headers_ms: r.get("elapsed_headers_ms")?,
            elapsed_ms: r.get("elapsed_ms")?,
            error: r.get("error")?,
            // Absent from a database read before its migrations have run.
            saved_request_id: match r.get("saved_request_id") {
                Err(rusqlite::Error::InvalidColumnName(_)) => None,
                v => v?,
            },
        })
    }
}
