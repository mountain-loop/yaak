//! What crosses the wire between a tab and this server.
//!
//! One `POST /v1/http/send` carries a request the tab has already rendered —
//! templates resolved, inheritance applied — plus the send settings and the
//! cookies the send starts with. The reply is a stream of newline-delimited
//! JSON frames: timeline events as they happen, the response head as soon as
//! headers arrive, body chunks as they are read, and one terminal frame.
//!
//! Nothing here names a workspace, a request id, or a response id. The server
//! does not know what the tab will call this response; it only knows what came
//! back.
//!
//! The TypeScript side of this contract is generated from these types into
//! `bindings/` (`cargo test -p yaak-web`) and published to the tab as
//! `@yaakapp-internal/web`, so a change here is a type error there.

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_models::models::{
    Cookie, HttpRequest, HttpResponseEventData, HttpResponseHeader, HttpSendSettings,
};

/// The body of `POST /v1/http/send`.
#[derive(Deserialize, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_web.ts")]
pub struct SendRequest {
    /// The request to send, in the desktop's own model shape but with every template already
    /// rendered by the tab. The server builds the URL, headers and body from it exactly the way
    /// the desktop does after rendering.
    pub request: HttpRequest,
    /// The resolved settings, values only. Where they came from is the tab's to record in
    /// its timeline; the server only needs to obey them.
    pub settings: HttpSendSettings,
    /// The cookies to start with. `None` means no jar at all: nothing sent, nothing kept.
    #[serde(default)]
    pub cookies: Option<Vec<Cookie>>,
}

/// One line of the reply stream. Tags are snake_case like the timeline event tags; fields are
/// camelCase like every model the tab stores.
#[derive(Serialize, Debug, TS)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "gen_web.ts")]
pub enum Frame {
    /// A timeline event, in the same shape the desktop stores. Interleaved with everything
    /// else in the order the engine produced it.
    Event { event: HttpResponseEventData },
    /// The response head. Sent once, as soon as the final hop's headers are in — before any of
    /// the body — so the tab can show status and headers while the body streams.
    Response {
        status: u16,
        status_reason: Option<String>,
        /// The URL that answered, after redirects.
        url: String,
        remote_addr: Option<String>,
        version: Option<String>,
        headers: Vec<HttpResponseHeader>,
        /// The headers that were actually sent on the final hop, cookies and all.
        request_headers: Vec<HttpResponseHeader>,
        /// `Content-Length` as declared by the server, if it declared one.
        #[ts(type = "number | null")]
        content_length: Option<u64>,
        /// Milliseconds from the start of the send to the response head.
        #[ts(type = "number")]
        elapsed_headers: u64,
        /// Milliseconds spent in DNS on the last lookup, or zero.
        #[ts(type = "number")]
        elapsed_dns: u64,
    },
    /// A piece of the response body, decompressed, base64-encoded.
    Body { data: String },
    /// The send finished. The last frame on a successful stream.
    Done {
        /// Milliseconds from the start of the send to the end of the body.
        #[ts(type = "number")]
        elapsed: u64,
        /// Bytes of body relayed, after decompression.
        #[ts(type = "number")]
        content_length: u64,
        /// Bytes on the wire as declared by the server, or the relayed size when unknown.
        #[ts(type = "number")]
        content_length_compressed: u64,
        /// The jar as the send left it, for the tab to persist. `None` when the tab sent none.
        cookies: Option<Vec<Cookie>>,
    },
    /// The send failed. The last frame on a failed stream. Cookies collected before the failure
    /// still come back — the transaction may have set some before the hop that failed.
    Error {
        message: String,
        cookies: Option<Vec<Cookie>>,
    },
}
