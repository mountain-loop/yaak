use crate::decompress::{ContentEncoding, streaming_decoder};
use crate::error::{Error, Result};
use crate::types::{SendableBody, SendableHttpRequest};
use async_trait::async_trait;
use bytes::Bytes;
use futures_util::StreamExt;
use http_body::{Body as HttpBody, Frame, SizeHint};
use reqwest::{Client, Method, Version};
use std::fmt::Display;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, BufReader, ReadBuf};
use tokio::sync::mpsc;
use tokio_util::io::StreamReader;

#[derive(Debug, Clone)]
pub enum RedirectBehavior {
    /// 307/308: Method and body are preserved
    Preserve,
    /// 303 or 301/302 with POST: Method changed to GET, body dropped
    DropBody,
}

#[derive(Debug, Clone)]
pub enum HttpResponseEvent {
    Setting(String, String),
    Info(String),
    Redirect {
        url: String,
        status: u16,
        behavior: RedirectBehavior,
    },
    SendUrl {
        method: String,
        scheme: String,
        username: String,
        password: String,
        host: String,
        port: u16,
        path: String,
        query: String,
        fragment: String,
    },
    ReceiveUrl {
        version: Version,
        status: String,
    },
    HeaderUp(String, String),
    HeaderDown(String, String),
    ChunkSent {
        bytes: usize,
    },
    ChunkReceived {
        bytes: usize,
    },
    DnsResolved {
        hostname: String,
        addresses: Vec<String>,
        duration: u64,
        overridden: bool,
    },
}

impl Display for HttpResponseEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HttpResponseEvent::Setting(name, value) => write!(f, "* Setting {}={}", name, value),
            HttpResponseEvent::Info(s) => write!(f, "* {}", s),
            HttpResponseEvent::Redirect { url, status, behavior } => {
                let behavior_str = match behavior {
                    RedirectBehavior::Preserve => "preserve",
                    RedirectBehavior::DropBody => "drop body",
                };
                write!(f, "* Redirect {} -> {} ({})", status, url, behavior_str)
            }
            HttpResponseEvent::SendUrl { method, scheme, username, password, host, port, path, query, fragment } => {
                let auth_str = if username.is_empty() && password.is_empty() {
                    String::new()
                } else {
                    format!("{}:{}@", username, password)
                };
                let query_str = if query.is_empty() { String::new() } else { format!("?{}", query) };
                let fragment_str = if fragment.is_empty() { String::new() } else { format!("#{}", fragment) };
                write!(f, "> {} {}://{}{}:{}{}{}{}", method, scheme, auth_str, host, port, path, query_str, fragment_str)
            }
            HttpResponseEvent::ReceiveUrl { version, status } => {
                write!(f, "< {} {}", version_to_str(version), status)
            }
            HttpResponseEvent::HeaderUp(name, value) => write!(f, "> {}: {}", name, value),
            HttpResponseEvent::HeaderDown(name, value) => write!(f, "< {}: {}", name, value),
            HttpResponseEvent::ChunkSent { bytes } => write!(f, "> [{} bytes sent]", bytes),
            HttpResponseEvent::ChunkReceived { bytes } => write!(f, "< [{} bytes received]", bytes),
            HttpResponseEvent::DnsResolved { hostname, addresses, duration, overridden } => {
                if *overridden {
                    write!(f, "* DNS override {} -> {}", hostname, addresses.join(", "))
                } else {
                    write!(
                        f,
                        "* DNS resolved {} to {} ({}ms)",
                        hostname,
                        addresses.join(", "),
                        duration
                    )
                }
            }
        }
    }
}

impl From<HttpResponseEvent> for yaak_models::models::HttpResponseEventData {
    fn from(event: HttpResponseEvent) -> Self {
        use yaak_models::models::HttpResponseEventData as D;
        match event {
            HttpResponseEvent::Setting(name, value) => D::Setting { name, value },
            HttpResponseEvent::Info(message) => D::Info { message },
            HttpResponseEvent::Redirect { url, status, behavior } => D::Redirect {
                url,
                status,
                behavior: match behavior {
                    RedirectBehavior::Preserve => "preserve".to_string(),
                    RedirectBehavior::DropBody => "drop_body".to_string(),
                },
            },
            HttpResponseEvent::SendUrl { method, scheme, username, password, host, port, path, query, fragment } => {
                D::SendUrl { method, scheme, username, password, host, port, path, query, fragment }
            }
            HttpResponseEvent::ReceiveUrl { version, status } => {
                D::ReceiveUrl { version: format!("{:?}", version), status }
            }
            HttpResponseEvent::HeaderUp(name, value) => D::HeaderUp { name, value },
            HttpResponseEvent::HeaderDown(name, value) => D::HeaderDown { name, value },
            HttpResponseEvent::ChunkSent { bytes } => D::ChunkSent { bytes },
            HttpResponseEvent::ChunkReceived { bytes } => D::ChunkReceived { bytes },
            HttpResponseEvent::DnsResolved { hostname, addresses, duration, overridden } => {
                D::DnsResolved { hostname, addresses, duration, overridden }
            }
        }
    }
}

/// Statistics about the body after consumption
#[derive(Debug, Default, Clone)]
pub struct BodyStats {
    /// Size of the body as received over the wire (before decompression)
    pub size_compressed: u64,
    /// Size of the body after decompression
    pub size_decompressed: u64,
}

/// An AsyncRead wrapper that sends chunk events as data is read
pub struct TrackingRead<R> {
    inner: R,
    event_tx: mpsc::Sender<HttpResponseEvent>,
    ended: bool,
}

impl<R> TrackingRead<R> {
    pub fn new(inner: R, event_tx: mpsc::Sender<HttpResponseEvent>) -> Self {
        Self { inner, event_tx, ended: false }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for TrackingRead<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &result {
            let bytes_read = buf.filled().len() - before;
            if bytes_read > 0 {
                // Ignore send errors - receiver may have been dropped or channel is full
                let _ =
                    self.event_tx.try_send(HttpResponseEvent::ChunkReceived { bytes: bytes_read });
            } else if !self.ended {
                self.ended = true;
            }
        }
        result
    }
}

/// Type alias for the body stream
type BodyStream = Pin<Box<dyn AsyncRead + Send>>;

/// HTTP response with deferred body consumption.
/// Headers are available immediately after send(), body can be consumed in different ways.
/// Note: Debug is manually implemented since BodyStream doesn't implement Debug.
pub struct HttpResponse {
    /// HTTP status code
    pub status: u16,
    /// HTTP status reason phrase (e.g., "OK", "Not Found")
    pub status_reason: Option<String>,
    /// Response headers (Vec to support multiple headers with same name, e.g., Set-Cookie)
    pub headers: Vec<(String, String)>,
    /// Request headers (Vec to support multiple headers with same name)
    pub request_headers: Vec<(String, String)>,
    /// Content-Length from headers (may differ from actual body size)
    pub content_length: Option<u64>,
    /// Final URL (after redirects)
    pub url: String,
    /// Remote address of the server
    pub remote_addr: Option<String>,
    /// HTTP version (e.g., "HTTP/1.1", "HTTP/2")
    pub version: Option<String>,

    /// The body stream (consumed when calling bytes(), text(), write_to_file(), or drain())
    body_stream: Option<BodyStream>,
    /// Content-Encoding for decompression
    encoding: ContentEncoding,
}

impl std::fmt::Debug for HttpResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpResponse")
            .field("status", &self.status)
            .field("status_reason", &self.status_reason)
            .field("headers", &self.headers)
            .field("content_length", &self.content_length)
            .field("url", &self.url)
            .field("remote_addr", &self.remote_addr)
            .field("version", &self.version)
            .field("body_stream", &"<stream>")
            .field("encoding", &self.encoding)
            .finish()
    }
}

impl HttpResponse {
    /// Create a new HttpResponse with an unconsumed body stream
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        status: u16,
        status_reason: Option<String>,
        headers: Vec<(String, String)>,
        request_headers: Vec<(String, String)>,
        content_length: Option<u64>,
        url: String,
        remote_addr: Option<String>,
        version: Option<String>,
        body_stream: BodyStream,
        encoding: ContentEncoding,
    ) -> Self {
        Self {
            status,
            status_reason,
            headers,
            request_headers,
            content_length,
            url,
            remote_addr,
            version,
            body_stream: Some(body_stream),
            encoding,
        }
    }

    /// Consume the body and return it as bytes (loads entire body into memory).
    /// Also decompresses the body if Content-Encoding is set.
    pub async fn bytes(mut self) -> Result<(Vec<u8>, BodyStats)> {
        let stream = self.body_stream.take().ok_or_else(|| {
            Error::RequestError("Response body has already been consumed".to_string())
        })?;

        let buf_reader = BufReader::new(stream);
        let mut decoder = streaming_decoder(buf_reader, self.encoding);

        let mut decompressed = Vec::new();
        let mut bytes_read = 0u64;

        // Read through the decoder in chunks to track compressed size
        let mut buf = [0u8; 8192];
        loop {
            match decoder.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    decompressed.extend_from_slice(&buf[..n]);
                    bytes_read += n as u64;
                }
                Err(e) => {
                    return Err(Error::BodyReadError(e.to_string()));
                }
            }
        }

        let stats = BodyStats {
            // For now, we can't easily track compressed size when streaming through decoder
            // Use content_length as an approximation, or decompressed size if identity encoding
            size_compressed: self.content_length.unwrap_or(bytes_read),
            size_decompressed: decompressed.len() as u64,
        };

        Ok((decompressed, stats))
    }

    /// Consume the body and return it as a UTF-8 string.
    pub async fn text(self) -> Result<(String, BodyStats)> {
        let (bytes, stats) = self.bytes().await?;
        let text = String::from_utf8(bytes)
            .map_err(|e| Error::RequestError(format!("Response is not valid UTF-8: {}", e)))?;
        Ok((text, stats))
    }

    /// Take the body stream for manual consumption.
    /// Returns an AsyncRead that decompresses on-the-fly if Content-Encoding is set.
    /// The caller is responsible for reading and processing the stream.
    pub fn into_body_stream(&mut self) -> Result<Box<dyn AsyncRead + Unpin + Send>> {
        let stream = self.body_stream.take().ok_or_else(|| {
            Error::RequestError("Response body has already been consumed".to_string())
        })?;

        let buf_reader = BufReader::new(stream);
        let decoder = streaming_decoder(buf_reader, self.encoding);

        Ok(decoder)
    }

    /// Discard the body without reading it (useful for redirects).
    pub async fn drain(mut self) -> Result<()> {
        let stream = self.body_stream.take().ok_or_else(|| {
            Error::RequestError("Response body has already been consumed".to_string())
        })?;

        // Just read and discard all bytes
        let mut reader = stream;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(_) => continue,
                Err(e) => {
                    return Err(Error::RequestError(format!(
                        "Failed to drain response body: {}",
                        e
                    )));
                }
            }
        }

        Ok(())
    }
}

/// Trait for sending HTTP requests
#[async_trait]
pub trait HttpSender: Send + Sync {
    /// Send an HTTP request and return the response with headers.
    /// The body is not consumed until you call bytes(), text(), write_to_file(), or drain().
    /// Events are sent through the provided channel.
    async fn send(
        &self,
        request: SendableHttpRequest,
        event_tx: mpsc::Sender<HttpResponseEvent>,
    ) -> Result<HttpResponse>;
}

/// Reqwest-based implementation of HttpSender
pub struct ReqwestSender {
    client: Client,
}

impl ReqwestSender {
    /// Create a new ReqwestSender with a default client
    pub fn new() -> Result<Self> {
        let client = Client::builder().build().map_err(Error::Client)?;
        Ok(Self { client })
    }

    /// Create a new ReqwestSender with a custom client
    pub fn with_client(client: Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl HttpSender for ReqwestSender {
    async fn send(
        &self,
        request: SendableHttpRequest,
        event_tx: mpsc::Sender<HttpResponseEvent>,
    ) -> Result<HttpResponse> {
        // Helper to send events (ignores errors if receiver is dropped or channel is full)
        let send_event = |event: HttpResponseEvent| {
            let _ = event_tx.try_send(event);
        };

        // Parse the HTTP method
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|e| Error::RequestError(format!("Invalid HTTP method: {}", e)))?;

        // Build the request
        let mut req_builder = self.client.request(method, &request.url);

        // Add headers
        for header in request.headers {
            if header.0.is_empty() {
                continue;
            }
            req_builder = req_builder.header(&header.0, &header.1);
        }

        // Configure timeout
        if let Some(d) = request.options.timeout
            && !d.is_zero()
        {
            req_builder = req_builder.timeout(d);
        }

        // Add body
        match request.body {
            None => {}
            Some(SendableBody::Bytes(bytes)) => {
                req_builder = req_builder.body(bytes);
            }
            Some(SendableBody::Stream { data, content_length }) => {
                // Convert AsyncRead stream to reqwest Body. If content length is
                // known, wrap with a SizedBody so hyper can set Content-Length
                // automatically (for both HTTP/1.1 and HTTP/2).
                let stream = tokio_util::io::ReaderStream::new(data);
                let body = if let Some(len) = content_length {
                    reqwest::Body::wrap(SizedBody::new(stream, len))
                } else {
                    reqwest::Body::wrap_stream(stream)
                };
                req_builder = req_builder.body(body);
            }
        }

        // Send the request
        let sendable_req = req_builder.build()?;
        send_event(HttpResponseEvent::Setting(
            "timeout".to_string(),
            if request.options.timeout.unwrap_or_default().is_zero() {
                "Infinity".to_string()
            } else {
                format!("{:?}", request.options.timeout)
            },
        ));

        send_event(HttpResponseEvent::SendUrl {
            method: sendable_req.method().to_string(),
            scheme: sendable_req.url().scheme().to_string(),
            username: sendable_req.url().username().to_string(),
            password: sendable_req.url().password().unwrap_or_default().to_string(),
            host: sendable_req.url().host_str().unwrap_or_default().to_string(),
            port: sendable_req.url().port_or_known_default().unwrap_or(0),
            path: sendable_req.url().path().to_string(),
            query: sendable_req.url().query().unwrap_or_default().to_string(),
            fragment: sendable_req.url().fragment().unwrap_or_default().to_string(),
        });

        let mut request_headers = Vec::new();
        for (name, value) in sendable_req.headers() {
            let v = value.to_str().unwrap_or_default().to_string();
            request_headers.push((name.to_string(), v.clone()));
            send_event(HttpResponseEvent::HeaderUp(name.to_string(), v));
        }
        send_event(HttpResponseEvent::Info("Sending request to server".to_string()));

        // Map some errors to our own, so they look nicer
        let response = self.client.execute(sendable_req).await.map_err(|e| {
            if reqwest::Error::is_timeout(&e) {
                Error::RequestTimeout(
                    request.options.timeout.unwrap_or(Duration::from_secs(0)).clone(),
                )
            } else {
                Error::Client(e)
            }
        })?;

        let status = response.status().as_u16();
        let status_reason = response.status().canonical_reason().map(|s| s.to_string());
        let url = response.url().to_string();
        let remote_addr = response.remote_addr().map(|a| a.to_string());
        let version = Some(version_to_str(&response.version()));
        let content_length = response.content_length();

        send_event(HttpResponseEvent::ReceiveUrl {
            version: response.version(),
            status: response.status().to_string(),
        });

        // Extract headers (use Vec to preserve duplicates like Set-Cookie)
        let mut headers = Vec::new();
        for (key, value) in response.headers() {
            if let Ok(v) = value.to_str() {
                send_event(HttpResponseEvent::HeaderDown(key.to_string(), v.to_string()));
                headers.push((key.to_string(), v.to_string()));
            }
        }

        // Determine content encoding for decompression
        // HTTP headers are case-insensitive, so we need to search for any casing
        let encoding = ContentEncoding::from_header(
            headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("content-encoding"))
                .map(|(_, v)| v.as_str()),
        );

        // Get the byte stream instead of loading into memory
        let byte_stream = response.bytes_stream();

        // Convert the stream to an AsyncRead
        let stream_reader = StreamReader::new(
            byte_stream.map(|result| result.map_err(|e| std::io::Error::other(e))),
        );

        // Wrap the stream with tracking to emit chunk received events via the same channel
        let tracking_reader = TrackingRead::new(stream_reader, event_tx);
        let body_stream: BodyStream = Box::pin(tracking_reader);

        Ok(HttpResponse::new(
            status,
            status_reason,
            headers,
            request_headers,
            content_length,
            url,
            remote_addr,
            version,
            body_stream,
            encoding,
        ))
    }
}

/// A wrapper around a byte stream that reports a known content length via
/// `size_hint()`. This lets hyper set the `Content-Length` header
/// automatically based on the body size, without us having to add it as an
/// explicit header — which can cause duplicate `Content-Length` headers and
/// break HTTP/2.
struct SizedBody<S> {
    stream: std::sync::Mutex<S>,
    remaining: u64,
}

impl<S> SizedBody<S> {
    fn new(stream: S, content_length: u64) -> Self {
        Self { stream: std::sync::Mutex::new(stream), remaining: content_length }
    }
}

impl<S> HttpBody for SizedBody<S>
where
    S: futures_util::Stream<Item = std::result::Result<Bytes, std::io::Error>> + Send + Unpin + 'static,
{
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<std::result::Result<Frame<Self::Data>, Self::Error>>> {
        let this = self.get_mut();
        let mut stream = this.stream.lock().unwrap();
        match stream.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(chunk))) => {
                this.remaining = this.remaining.saturating_sub(chunk.len() as u64);
                Poll::Ready(Some(Ok(Frame::data(chunk))))
            }
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(e))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }

    fn size_hint(&self) -> SizeHint {
        SizeHint::with_exact(self.remaining)
    }
}

fn version_to_str(version: &Version) -> String {
    match *version {
        Version::HTTP_09 => "HTTP/0.9".to_string(),
        Version::HTTP_10 => "HTTP/1.0".to_string(),
        Version::HTTP_11 => "HTTP/1.1".to_string(),
        Version::HTTP_2 => "HTTP/2".to_string(),
        Version::HTTP_3 => "HTTP/3".to_string(),
        _ => "unknown".to_string(),
    }
}
