//! The one thing this binary does: execute a rendered request and stream back what happened.
//!
//! This is the "execute" half of the desktop's `send_http_request` — the part after rendering
//! and before storage — driven through the same `HttpTransaction` the desktop drives, with the
//! same redirect loop, cookie jar, decompression and timeline events. Everything the desktop
//! would write to its database is written to the reply stream instead, and the tab stores it.

use crate::guard::{DestinationPolicy, GuardedSender};
use crate::wire::{Frame, SendRequest};
use base64::Engine;
use bytes::Bytes;
use log::{info, warn};
use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, watch};
use yaak_http::client::{HttpConnectionOptions, HttpConnectionProxySetting};
use yaak_http::cookies::CookieStore;
use yaak_http::sender::{HttpResponseEvent, ReqwestSender};
use yaak_http::transaction::HttpTransaction;
use yaak_http::types::{SendableHttpRequest, SendableHttpRequestOptions};
use yaak_models::models::HttpResponseHeader;

/// How many frames may sit unread by the client before body reading pauses. Backpressure, so a
/// slow tab slows the upstream read rather than filling memory.
pub const FRAME_CHANNEL_CAPACITY: usize = 64;
const EVENT_CHANNEL_CAPACITY: usize = 256;
const BODY_READ_CHUNK: usize = 64 * 1024;

/// What a send needs from the process, beyond the request itself.
pub struct SendLimits {
    pub policy: DestinationPolicy,
    pub max_response_bytes: usize,
    pub max_timeout: Duration,
}

/// Why a send was refused before anything was put on the network. Distinct from a failure
/// mid-stream: these become a plain HTTP error, not a stream with an error frame.
#[derive(Debug)]
pub enum Refusal {
    /// The request asks for something a browser-originated send cannot mean.
    Unsupported(String),
    /// The destination is not one this server will talk to.
    Destination(String),
    /// The request could not be turned into something sendable.
    Invalid(String),
}

pub type FrameSender = mpsc::Sender<Result<Bytes, Infallible>>;

/// Check and prepare a send, then hand back the task that runs it. Refusals happen here, before
/// the caller has committed to a streaming response.
pub async fn prepare(limits: Arc<SendLimits>, send: SendRequest) -> Result<PreparedSend, Refusal> {
    let request = send.request;

    // The engine reads files for these body types. There are no files here that a browser tab
    // could legitimately mean, and letting a request name a path on this machine would be a
    // local file read for anyone who can reach the server.
    if request.body_type.as_deref() == Some("binary") {
        return Err(Refusal::Unsupported(
            "Binary file bodies can't be sent from the browser: the server has no access to your files"
                .to_string(),
        ));
    }
    if request.body_type.as_deref() == Some("multipart/form-data") {
        let names_a_file =
            request.body.get("form").and_then(|f| f.as_array()).is_some_and(|entries| {
                entries.iter().any(|e| {
                    e.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true)
                        && e.get("file").and_then(|v| v.as_str()).is_some_and(|f| !f.is_empty())
                })
            });
        if names_a_file {
            return Err(Refusal::Unsupported(
                "Multipart file fields can't be sent from the browser: the server has no access to your files"
                    .to_string(),
            ));
        }
    }

    // The tab's requested timeout, capped. Zero means "none", which here means the cap.
    let requested = if send.settings.timeout_ms > 0 {
        Some(Duration::from_millis(send.settings.timeout_ms as u64))
    } else {
        None
    };
    let timeout = requested.map_or(limits.max_timeout, |t| t.min(limits.max_timeout));
    let timeout_capped = requested.is_none_or(|t| t > limits.max_timeout);

    let sendable = SendableHttpRequest::from_http_request(
        &request,
        SendableHttpRequestOptions {
            timeout: Some(timeout),
            follow_redirects: send.settings.follow_redirects,
        },
    )
    .await
    .map_err(|e| Refusal::Invalid(e.to_string()))?;

    // The first hop, checked up front so a bad destination is a clean refusal rather than a
    // stream that opens and immediately errors. Every later hop is checked by GuardedSender.
    limits.policy.check_url(&sendable.url).map_err(Refusal::Destination)?;

    Ok(PreparedSend {
        limits,
        sendable,
        settings: send.settings,
        cookies: send.cookies,
        timeout,
        timeout_capped,
    })
}

pub struct PreparedSend {
    limits: Arc<SendLimits>,
    sendable: SendableHttpRequest,
    settings: yaak_models::models::HttpSendSettings,
    cookies: Option<Vec<yaak_models::models::Cookie>>,
    timeout: Duration,
    timeout_capped: bool,
}

impl PreparedSend {
    pub fn describe(&self) -> String {
        format!("{} {}", self.sendable.method, self.sendable.url)
    }

    /// Run the send, writing frames to `frames` until the terminal frame. Returns when the
    /// stream is complete or the client has gone away.
    pub async fn run(mut self, frames: FrameSender) {
        let cookie_store = self.cookies.take().map(CookieStore::from_cookies);
        let store_for_result = cookie_store.clone();
        let outcome = self.execute(frames.clone(), cookie_store).await;

        let cookies = store_for_result.as_ref().map(|s| s.get_all_cookies());
        let terminal = match outcome {
            Ok(done) => Frame::Done {
                elapsed: done.elapsed,
                content_length: done.content_length,
                content_length_compressed: done.content_length_compressed,
                cookies,
            },
            Err(message) => Frame::Error { message, cookies },
        };
        let _ = write_frame(&frames, &terminal).await;
    }

    async fn execute(
        self,
        frames: FrameSender,
        cookie_store: Option<CookieStore>,
    ) -> Result<DoneStats, String> {
        let limits = self.limits;

        let (client, resolver) = HttpConnectionOptions {
            id: uuid::Uuid::new_v4().to_string(),
            validate_certificates: self.settings.validate_certificates,
            http_version: self.settings.http_version,
            // The proxy connects directly. Going through a system proxy would move DNS, and
            // therefore the address check, somewhere this process can't see.
            proxy: HttpConnectionProxySetting::Disabled,
            client_certificate: None,
            dns_overrides: Vec::new(),
            address_filter: Some(limits.policy.address_filter()),
        }
        .build_client()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

        // Timeline events go into the same frame stream as everything else, as they happen.
        // The desktop persists them from a task like this one; here the task serialises them.
        let (event_tx, mut event_rx) = mpsc::channel::<HttpResponseEvent>(EVENT_CHANNEL_CAPACITY);
        resolver.set_event_sender(Some(event_tx.clone())).await;
        let dns_elapsed = Arc::new(AtomicU64::new(0));
        let event_frames = frames.clone();
        let event_dns = dns_elapsed.clone();
        let event_task = tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                if let HttpResponseEvent::DnsResolved { duration, .. } = &event {
                    event_dns.store(*duration, Ordering::Relaxed);
                }
                let frame = Frame::Event { event: event.into() };
                if write_frame(&event_frames, &frame).await.is_err() {
                    break;
                }
            }
        });

        // Cancellation: the client hanging up, or the overall deadline. The deadline exists
        // because a per-hop timeout times each hop separately; ten slow redirects must not add
        // up to ten timeouts.
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let deadline = self.timeout * 2 + Duration::from_secs(5);
        let deadline_cancel = cancel_tx.clone();
        let deadline_task = tokio::spawn(async move {
            tokio::time::sleep(deadline).await;
            let _ = deadline_cancel.send(true);
        });
        let hangup_frames = frames.clone();
        let hangup_task = tokio::spawn(async move {
            hangup_frames.closed().await;
            let _ = cancel_tx.send(true);
        });

        if self.timeout_capped {
            let _ = event_tx.try_send(HttpResponseEvent::Info(format!(
                "Timeout set to {:?} (this server's ceiling)",
                self.timeout
            )));
        }

        let sender = GuardedSender::new(ReqwestSender::with_client(client), limits.policy.clone());
        let transaction = match cookie_store {
            Some(store) => HttpTransaction::with_cookie_behavior(
                sender,
                store,
                self.settings.send_cookies,
                self.settings.store_cookies,
            ),
            None => HttpTransaction::new(sender),
        };

        let started_at = Instant::now();
        let result = transaction
            .execute_with_cancellation(self.sendable, cancel_rx.clone(), event_tx.clone())
            .await;
        resolver.set_event_sender(None).await;

        let mut response = match result {
            Ok(response) => response,
            Err(err) => {
                drop(event_tx);
                let _ = event_task.await;
                deadline_task.abort();
                hangup_task.abort();
                return Err(describe_error(&err));
            }
        };

        let elapsed_headers = started_at.elapsed().as_millis() as u64;
        let head = Frame::Response {
            status: response.status,
            status_reason: response.status_reason.clone(),
            url: response.url.clone(),
            remote_addr: response.remote_addr.clone(),
            version: response.version.clone(),
            headers: to_wire_headers(&response.headers),
            request_headers: to_wire_headers(&response.request_headers),
            content_length: response.content_length,
            elapsed_headers,
            elapsed_dns: dns_elapsed.load(Ordering::Relaxed),
        };
        write_frame(&frames, &head).await.map_err(|_| "Client went away".to_string())?;

        let declared_length = response.content_length;
        let mut body = response
            .into_body_stream()
            .map_err(|e| format!("Failed to read response body: {e}"))?;
        let mut buf = vec![0u8; BODY_READ_CHUNK];
        let mut total: usize = 0;
        let mut cancel_rx = cancel_rx;
        let base64 = base64::engine::general_purpose::STANDARD;

        let read_result: Result<(), String> = loop {
            if *cancel_rx.borrow() {
                break Err("Request canceled".to_string());
            }
            let read = tokio::select! {
                biased;
                _ = cancel_rx.changed() => break Err("Request canceled".to_string()),
                r = body.read(&mut buf) => r,
            };
            match read {
                Ok(0) => break Ok(()),
                Ok(n) => {
                    total += n;
                    if total > limits.max_response_bytes {
                        break Err(format!(
                            "Response body exceeds this server's limit of {} bytes",
                            limits.max_response_bytes
                        ));
                    }
                    let frame = Frame::Body { data: base64.encode(&buf[..n]) };
                    if write_frame(&frames, &frame).await.is_err() {
                        break Err("Client went away".to_string());
                    }
                }
                Err(e) => break Err(format!("Failed to read response body: {e}")),
            }
        };
        drop(body);

        // Let the timeline drain before the terminal frame, so nothing arrives after "done".
        drop(event_tx);
        let _ = event_task.await;
        deadline_task.abort();
        hangup_task.abort();

        read_result?;
        Ok(DoneStats {
            elapsed: started_at.elapsed().as_millis() as u64,
            content_length: total as u64,
            content_length_compressed: declared_length.unwrap_or(total as u64),
        })
    }
}

/// A send error as a sentence, not a debug dump.
///
/// A connection error from reqwest arrives wrapped several layers deep, and the layer that
/// says something useful — "Refusing to connect to ::1: loopback" — is the innermost. The
/// desktop shows the outer `Debug`; a stranger reading its reply deserves the reason.
fn describe_error(err: &yaak_http::error::Error) -> String {
    match err {
        yaak_http::error::Error::Client(e) => {
            let mut leaf: &dyn std::error::Error = e;
            while let Some(next) = leaf.source() {
                leaf = next;
            }
            let outer = e.to_string();
            let inner = leaf.to_string();
            if inner == outer { outer } else { format!("{outer}: {inner}") }
        }
        yaak_http::error::Error::RequestError(message) => format!("Request failed: {message}"),
        other => other.to_string(),
    }
}

struct DoneStats {
    elapsed: u64,
    content_length: u64,
    content_length_compressed: u64,
}

fn to_wire_headers(headers: &[(String, String)]) -> Vec<HttpResponseHeader> {
    headers
        .iter()
        .map(|(name, value)| HttpResponseHeader { name: name.clone(), value: value.clone() })
        .collect()
}

async fn write_frame(frames: &FrameSender, frame: &Frame) -> Result<(), ()> {
    let mut line = match serde_json::to_vec(frame) {
        Ok(v) => v,
        Err(e) => {
            warn!("Failed to serialize frame: {e}");
            return Err(());
        }
    };
    line.push(b'\n');
    frames.send(Ok(Bytes::from(line))).await.map_err(|_| ())
}

/// Log a finished send at info: destination, outcome, and how long, never the content.
pub fn log_outcome(description: &str, started: Instant, outcome: &str) {
    info!("{description} -> {outcome} in {:?}", started.elapsed());
}
