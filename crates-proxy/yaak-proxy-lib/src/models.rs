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

/// One proxied request and its response. The bodies are in `blobs.sqlite`, not the row; a
/// stream's are its messages, and read back from them (`bodies::from_messages`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "flows")]
pub struct Flow {
    pub id: String,
    /// The flow's short handle, `#1429`: its rowid, which grows as flows are written and is kept
    /// across updates. Zero when read without it.
    #[ts(type = "number")]
    pub number: i64,
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
    /// Only the first `capture_body_limit` bytes of the body are stored. For a body that is a
    /// stream's messages, a message was cut at the limit.
    pub request_truncated: bool,
    /// Only the first `capture_body_limit` bytes of the body are stored. For a body that is a
    /// stream's messages, a message was cut at the limit.
    pub response_truncated: bool,
    /// Milliseconds from `started_at` to the response headers.
    pub elapsed_headers_ms: Option<i32>,
    /// Milliseconds from `started_at` to the end of the response.
    pub elapsed_ms: Option<i32>,
    /// Milliseconds from `started_at` to the TCP connection to the server, and to the end of
    /// its TLS handshake. Only for intercepted HTTPS on a connection opened for this flow.
    pub elapsed_connect_ms: Option<i32>,
    pub elapsed_tls_ms: Option<i32>,
    /// Milliseconds from `started_at` to the request body being sent whole. None without one.
    pub elapsed_request_ms: Option<i32>,
    /// The client's end of its connection: `127.0.0.1:54321`.
    pub client_addr: Option<String>,
    /// The TLS negotiated with the server for intercepted HTTPS: `TLSv1.3`.
    pub upstream_tls_version: Option<String>,
    /// `TLS13_AES_128_GCM_SHA256`.
    pub upstream_tls_cipher: Option<String>,
    pub error: Option<String>,
    /// The client gave up before the response ended, by resetting its HTTP/2 stream or closing
    /// the connection. Not an error.
    pub cancelled: bool,
    /// The id of the Yaak request this flow was last saved as.
    pub saved_request_id: Option<String>,
    /// The process that opened the client connection, where the platform can tell (macOS).
    pub client_pid: Option<i32>,
    /// Its app's name, or its executable's outside an app: "Google Chrome", "curl".
    pub client_name: Option<String>,
    /// Its app's bundle id.
    pub client_bundle_id: Option<String>,
    /// Its app bundle's path, or its executable's outside an app.
    pub client_path: Option<String>,
    /// The working directory of a process outside an app, whose folder names it: `node` in
    /// `fieldwork`.
    pub client_cwd: Option<String>,
    /// The flow carries a stream of messages, listed with `list_messages`. It is written as the
    /// stream opens and again as messages land; it is open until `elapsedMs`, `error` or
    /// `cancelled` is set.
    pub stream_kind: Option<StreamKind>,
    /// Messages recorded so far.
    #[ts(type = "number")]
    pub message_count: i64,
    /// A gRPC call's service, from its path: `package.Service`.
    pub grpc_service: Option<String>,
    /// A gRPC call's method, from its path.
    pub grpc_method: Option<String>,
    /// A gRPC call's status, from its trailers. Not 0 is a failed call.
    pub grpc_status: Option<i32>,
    /// A gRPC call's `grpc-message`, decoded.
    pub grpc_message: Option<String>,
    /// A GraphQL request's operation, from its body or URL: `GetUser`, `GetUser +2` for a
    /// batch, empty for an anonymous one. None when the request is not GraphQL.
    pub graphql_operation: Option<String>,
    /// An HTTPS connection passed through undecrypted, as the decrypt list leaves it out or its
    /// client rejected the proxy's certificate: method `CONNECT`, its URL the host, its sizes
    /// the bytes each way, and no headers or bodies. Open until `elapsedMs` or `error` is set.
    pub tunnelled: bool,
    /// Why a tunnelled flow was not decrypted. None for other flows, and for tunnels recorded
    /// before the reason was.
    pub tunnel_reason: Option<TunnelReason>,
    /// For a tunnel the decrypt list excluded, the exclusion that kept it out, as stored:
    /// `!host:*.apple.com`.
    pub tunnel_excluded_by: Option<String>,
    /// That exclusion is one of the built-in ones.
    pub tunnel_excluded_built_in: bool,
    /// For a tunnel passed through after a client rejected the proxy's certificate, the id of
    /// the flow of that refused handshake, when it was recorded.
    pub tunnel_rejected_by: Option<String>,
    /// The proxy closed this tunnel on request, so its client would reconnect.
    pub reconnect_requested: bool,
    /// A client's refused TLS handshake, recorded as its host and port began to be passed
    /// through: how it refused, its alert (`unknown_ca`, `bad_certificate`,
    /// `certificate_unknown`, ...) or `hang_up`. Such a flow has no method, its URL is
    /// `https://<authority>`, and its error says it rejected the certificate. A handshake that
    /// failed otherwise is recorded the same way with this None and the failure as its error.
    pub tls_rejected: Option<String>,
    /// An agent read the flow through the control API: its detail, a body or its messages.
    /// Never written by an upsert, which keeps what is stored.
    pub agent_read: bool,
}

/// Why a tunnel was passed through undecrypted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum TunnelReason {
    /// No entry of the decrypt list named it.
    NotListed,
    /// An entry named it, and an exclusion kept it out: `tunnelExcludedBy`.
    Excluded,
    /// The list decrypts it, but a client rejected the proxy's certificate for its host and
    /// port, which are passed through until the proxy restarts or forgets them.
    Rejected,
}

impl TunnelReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotListed => "not_listed",
            Self::Excluded => "excluded",
            Self::Rejected => "rejected",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [Self::NotListed, Self::Excluded, Self::Rejected].into_iter().find(|r| r.as_str() == s)
    }
}

/// The streaming protocol a flow carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum StreamKind {
    Websocket,
    Sse,
    Grpc,
    GrpcWeb,
}

impl StreamKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Websocket => "websocket",
            Self::Sse => "sse",
            Self::Grpc => "grpc",
            Self::GrpcWeb => "grpc_web",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [Self::Websocket, Self::Sse, Self::Grpc, Self::GrpcWeb]
            .into_iter()
            .find(|k| k.as_str() == s)
    }

    pub fn is_grpc(self) -> bool {
        matches!(self, Self::Grpc | Self::GrpcWeb)
    }
}

impl From<yaak_proxy::StreamKind> for StreamKind {
    fn from(kind: yaak_proxy::StreamKind) -> Self {
        match kind {
            yaak_proxy::StreamKind::WebSocket => Self::Websocket,
            yaak_proxy::StreamKind::Sse => Self::Sse,
            yaak_proxy::StreamKind::Grpc => Self::Grpc,
            yaak_proxy::StreamKind::GrpcWeb => Self::GrpcWeb,
        }
    }
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

    /// A client's failed TLS handshake, recorded without a request: nothing to save or replay.
    pub fn is_handshake_only(&self) -> bool {
        self.method.is_empty()
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
    /// Whether the flow belongs in the list of the search the app shows, decided as the event
    /// is sent. None while no search is shown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub search: Option<SearchMatch>,
}

/// A written flow, matched against the search the app shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct SearchMatch {
    /// The search's key, as the app gave it with the search.
    pub key: String,
    pub matches: bool,
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
            (Cancelled, self.cancelled.into()),
            (SavedRequestId, self.saved_request_id.into()),
            (ClientPid, self.client_pid.into()),
            (ClientName, self.client_name.into()),
            (ClientBundleId, self.client_bundle_id.into()),
            (ClientPath, self.client_path.into()),
            (ClientCwd, self.client_cwd.into()),
            (FlowIden::StreamKind, self.stream_kind.map(|k| k.as_str()).into()),
            (MessageCount, self.message_count.into()),
            (GrpcService, self.grpc_service.into()),
            (GrpcMethod, self.grpc_method.into()),
            (GrpcStatus, self.grpc_status.into()),
            (GrpcMessage, self.grpc_message.into()),
            (GraphqlOperation, self.graphql_operation.into()),
            (Tunnelled, self.tunnelled.into()),
            (FlowIden::TunnelReason, self.tunnel_reason.map(|r| r.as_str()).into()),
            (TunnelExcludedBy, self.tunnel_excluded_by.into()),
            (TunnelExcludedBuiltIn, self.tunnel_excluded_built_in.into()),
            (TunnelRejectedBy, self.tunnel_rejected_by.into()),
            (ReconnectRequested, self.reconnect_requested.into()),
            (TlsRejected, self.tls_rejected.into()),
            (ElapsedConnectMs, self.elapsed_connect_ms.into()),
            (ElapsedTlsMs, self.elapsed_tls_ms.into()),
            (ElapsedRequestMs, self.elapsed_request_ms.into()),
            (ClientAddr, self.client_addr.into()),
            (UpstreamTlsVersion, self.upstream_tls_version.into()),
            (UpstreamTlsCipher, self.upstream_tls_cipher.into()),
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
            FlowIden::Cancelled,
            FlowIden::SavedRequestId,
            FlowIden::ClientPid,
            FlowIden::ClientName,
            FlowIden::ClientBundleId,
            FlowIden::ClientPath,
            FlowIden::ClientCwd,
            FlowIden::StreamKind,
            FlowIden::MessageCount,
            FlowIden::GrpcService,
            FlowIden::GrpcMethod,
            FlowIden::GrpcStatus,
            FlowIden::GrpcMessage,
            FlowIden::GraphqlOperation,
            FlowIden::Tunnelled,
            FlowIden::TunnelReason,
            FlowIden::TunnelExcludedBy,
            FlowIden::TunnelExcludedBuiltIn,
            FlowIden::TunnelRejectedBy,
            FlowIden::ReconnectRequested,
            FlowIden::TlsRejected,
            FlowIden::ElapsedConnectMs,
            FlowIden::ElapsedTlsMs,
            FlowIden::ElapsedRequestMs,
            FlowIden::ClientAddr,
            FlowIden::UpstreamTlsVersion,
            FlowIden::UpstreamTlsCipher,
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
            number: added_column(r, "rowid")?.unwrap_or_default(),
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
            elapsed_connect_ms: added_column(r, "elapsed_connect_ms")?,
            elapsed_tls_ms: added_column(r, "elapsed_tls_ms")?,
            elapsed_request_ms: added_column(r, "elapsed_request_ms")?,
            client_addr: added_column(r, "client_addr")?,
            upstream_tls_version: added_column(r, "upstream_tls_version")?,
            upstream_tls_cipher: added_column(r, "upstream_tls_cipher")?,
            error: r.get("error")?,
            cancelled: added_column(r, "cancelled")?.unwrap_or_default(),
            saved_request_id: added_column(r, "saved_request_id")?,
            client_pid: added_column(r, "client_pid")?,
            client_name: added_column(r, "client_name")?,
            client_bundle_id: added_column(r, "client_bundle_id")?,
            client_path: added_column(r, "client_path")?,
            client_cwd: added_column(r, "client_cwd")?,
            stream_kind: added_column::<String>(r, "stream_kind")?
                .and_then(|k| StreamKind::parse(&k)),
            message_count: added_column(r, "message_count")?.unwrap_or_default(),
            grpc_service: added_column(r, "grpc_service")?,
            grpc_method: added_column(r, "grpc_method")?,
            grpc_status: added_column(r, "grpc_status")?,
            grpc_message: added_column(r, "grpc_message")?,
            graphql_operation: added_column(r, "graphql_operation")?,
            tunnelled: added_column(r, "tunnelled")?.unwrap_or_default(),
            tunnel_reason: added_column::<String>(r, "tunnel_reason")?
                .and_then(|r| TunnelReason::parse(&r)),
            tunnel_excluded_by: added_column(r, "tunnel_excluded_by")?,
            tunnel_excluded_built_in: added_column(r, "tunnel_excluded_built_in")?
                .unwrap_or_default(),
            tunnel_rejected_by: added_column(r, "tunnel_rejected_by")?,
            reconnect_requested: added_column(r, "reconnect_requested")?.unwrap_or_default(),
            tls_rejected: added_column(r, "tls_rejected")?,
            agent_read: added_column(r, "agent_read")?.unwrap_or_default(),
        })
    }
}

/// A column added by a later migration, absent from a database read before it has run.
fn added_column<T: rusqlite::types::FromSql>(r: &Row, name: &str) -> rusqlite::Result<Option<T>> {
    match r.get(name) {
        Err(rusqlite::Error::InvalidColumnName(_)) => Ok(None),
        v => v,
    }
}
