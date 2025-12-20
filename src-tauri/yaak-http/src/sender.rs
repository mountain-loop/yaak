use crate::decompress::{ContentEncoding, streaming_decoder};
use crate::error::{Error, Result};
use crate::types::{SendableBody, SendableHttpRequest};
use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::{Client, Method, Version};
use std::collections::HashMap;
use std::fmt::Display;
use std::pin::Pin;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio_util::io::StreamReader;

#[derive(Debug, Default, Clone)]
pub struct HttpResponseTiming {
    pub headers: Duration,
    pub body: Duration,
}

#[derive(Debug)]
pub enum HttpResponseEvent {
    Setting(String, String),
    Info(String),
    SendUrl { method: String, path: String },
    ReceiveUrl { version: Version, status: String },
    HeaderUp(String, String),
    HeaderDown(String, String),
    HeaderUpDone,
    HeaderDownDone,
}

impl Display for HttpResponseEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HttpResponseEvent::Setting(name, value) => write!(f, "* Setting {}={}", name, value),
            HttpResponseEvent::Info(s) => write!(f, "* {}", s),
            HttpResponseEvent::SendUrl { method, path } => write!(f, "> {} {}", method, path),
            HttpResponseEvent::ReceiveUrl { version, status } => {
                write!(f, "< {} {}", version_to_str(version), status)
            }
            HttpResponseEvent::HeaderUp(name, value) => write!(f, "> {}: {}", name, value),
            HttpResponseEvent::HeaderUpDone => write!(f, ">"),
            HttpResponseEvent::HeaderDown(name, value) => write!(f, "< {}: {}", name, value),
            HttpResponseEvent::HeaderDownDone => write!(f, "<"),
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
    /// Response headers
    pub headers: HashMap<String, String>,
    /// Content-Length from headers (may differ from actual body size)
    pub content_length: Option<u64>,
    /// Final URL (after redirects)
    pub url: String,
    /// Remote address of the server
    pub remote_addr: Option<String>,
    /// HTTP version (e.g., "HTTP/1.1", "HTTP/2")
    pub version: Option<String>,
    /// Timing information
    pub timing: HttpResponseTiming,

    /// The body stream (consumed when calling bytes(), text(), write_to_file(), or drain())
    body_stream: Option<BodyStream>,
    /// Content-Encoding for decompression
    encoding: ContentEncoding,
    /// Start time for timing the body read
    start_time: Instant,
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
            .field("timing", &self.timing)
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
        headers: HashMap<String, String>,
        content_length: Option<u64>,
        url: String,
        remote_addr: Option<String>,
        version: Option<String>,
        timing: HttpResponseTiming,
        body_stream: BodyStream,
        encoding: ContentEncoding,
        start_time: Instant,
    ) -> Self {
        Self {
            status,
            status_reason,
            headers,
            content_length,
            url,
            remote_addr,
            version,
            timing,
            body_stream: Some(body_stream),
            encoding,
            start_time,
        }
    }

    /// Consume the body and return it as bytes (loads entire body into memory).
    /// Also decompresses the body if Content-Encoding is set.
    pub async fn bytes(mut self) -> Result<(Vec<u8>, BodyStats, HttpResponseTiming)> {
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
                    return Err(Error::DecompressionError(format!(
                        "Failed to read response body: {}",
                        e
                    )));
                }
            }
        }

        let mut timing = self.timing.clone();
        timing.body = self.start_time.elapsed();

        let stats = BodyStats {
            // For now, we can't easily track compressed size when streaming through decoder
            // Use content_length as an approximation, or decompressed size if identity encoding
            size_compressed: self.content_length.unwrap_or(bytes_read),
            size_decompressed: decompressed.len() as u64,
        };

        Ok((decompressed, stats, timing))
    }

    /// Consume the body and return it as a UTF-8 string.
    pub async fn text(self) -> Result<(String, BodyStats, HttpResponseTiming)> {
        let (bytes, stats, timing) = self.bytes().await?;
        let text = String::from_utf8(bytes)
            .map_err(|e| Error::RequestError(format!("Response is not valid UTF-8: {}", e)))?;
        Ok((text, stats, timing))
    }

    /// Take the body stream for manual consumption.
    /// Returns an AsyncRead that decompresses on-the-fly if Content-Encoding is set.
    /// The caller is responsible for reading and processing the stream.
    pub fn into_body_stream(mut self) -> Result<Box<dyn AsyncRead + Unpin + Send>> {
        let stream = self.body_stream.take().ok_or_else(|| {
            Error::RequestError("Response body has already been consumed".to_string())
        })?;

        let buf_reader = BufReader::new(stream);
        let decoder = streaming_decoder(buf_reader, self.encoding);

        Ok(decoder)
    }

    /// Discard the body without reading it (useful for redirects).
    pub async fn drain(mut self) -> Result<HttpResponseTiming> {
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

        let mut timing = self.timing.clone();
        timing.body = self.start_time.elapsed();

        Ok(timing)
    }
}

/// Trait for sending HTTP requests
#[async_trait]
pub trait HttpSender: Send + Sync {
    /// Send an HTTP request and return the response with headers.
    /// The body is not consumed until you call bytes(), text(), write_to_file(), or drain().
    async fn send(
        &self,
        request: SendableHttpRequest,
        events: &mut Vec<HttpResponseEvent>,
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
        events: &mut Vec<HttpResponseEvent>,
    ) -> Result<HttpResponse> {
        // Parse the HTTP method
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|e| Error::RequestError(format!("Invalid HTTP method: {}", e)))?;

        // Build the request
        let mut req_builder = self.client.request(method, &request.url);

        // Add headers
        for header in request.headers {
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
            Some(SendableBody::Stream(stream)) => {
                // Convert AsyncRead stream to reqwest Body
                let stream = tokio_util::io::ReaderStream::new(stream);
                let body = reqwest::Body::wrap_stream(stream);
                req_builder = req_builder.body(body);
            }
        }

        let start = Instant::now();
        let mut timing = HttpResponseTiming::default();

        // Send the request
        let sendable_req = req_builder.build()?;
        events.push(HttpResponseEvent::Setting(
            "timeout".to_string(),
            if request.options.timeout.unwrap_or_default().is_zero() {
                "Infinity".to_string()
            } else {
                format!("{:?}", request.options.timeout)
            },
        ));

        events.push(HttpResponseEvent::SendUrl {
            path: sendable_req.url().path().to_string(),
            method: sendable_req.method().to_string(),
        });

        for (name, value) in sendable_req.headers() {
            events.push(HttpResponseEvent::HeaderUp(
                name.to_string(),
                value.to_str().unwrap_or_default().to_string(),
            ));
        }
        events.push(HttpResponseEvent::HeaderUpDone);
        events.push(HttpResponseEvent::Info("Sending request to server".to_string()));

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

        events.push(HttpResponseEvent::ReceiveUrl {
            version: response.version(),
            status: response.status().to_string(),
        });

        timing.headers = start.elapsed();

        // Extract content length
        let content_length = response.content_length();

        // Extract headers
        let mut headers = HashMap::new();
        for (key, value) in response.headers() {
            if let Ok(v) = value.to_str() {
                events.push(HttpResponseEvent::HeaderDown(key.to_string(), v.to_string()));
                headers.insert(key.to_string(), v.to_string());
            }
        }
        events.push(HttpResponseEvent::HeaderDownDone);

        // Determine content encoding for decompression
        let encoding = ContentEncoding::from_header(
            headers
                .get("content-encoding")
                .or_else(|| headers.get("Content-Encoding"))
                .map(|s| s.as_str()),
        );

        // Get the byte stream instead of loading into memory
        let byte_stream = response.bytes_stream();

        // Convert the stream to an AsyncRead
        let stream_reader = StreamReader::new(
            byte_stream.map(|result| result.map_err(|e| std::io::Error::other(e))),
        );

        let body_stream: BodyStream = Box::pin(stream_reader);

        Ok(HttpResponse::new(
            status,
            status_reason,
            headers,
            content_length,
            url,
            remote_addr,
            version,
            timing,
            body_stream,
            encoding,
            start,
        ))
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
