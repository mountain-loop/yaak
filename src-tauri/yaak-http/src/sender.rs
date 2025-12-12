use crate::error::Result;
use crate::types::{SendableBody, SendableHttpRequest};
use async_trait::async_trait;
use reqwest::{Client, Method, Version};
use std::collections::HashMap;
use std::fmt::Display;
use std::time::Duration;
use tokio_util::io::ReaderStream;

#[derive(Debug, Default)]
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
            HttpResponseEvent::HeaderDown(name, value) => write!(f, "< {}: {}", name, value),
        }
    }
}

/// Basic response type for HTTP responses
#[derive(Debug, Default)]
pub struct SendableHttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
    pub content_length: Option<u64>,
    pub timing: HttpResponseTiming,
    pub events: Vec<HttpResponseEvent>,
}

/// Trait for sending HTTP requests
#[async_trait]
pub trait HttpSender: Send + Sync {
    /// Send an HTTP request and return the response
    async fn send(&self, request: SendableHttpRequest) -> Result<SendableHttpResponse>;
}

/// Reqwest-based implementation of HttpSender
pub struct ReqwestSender {
    client: Client,
}

impl ReqwestSender {
    /// Create a new ReqwestSender with a default client
    pub fn new() -> Result<Self> {
        let client = Client::builder().build().map_err(crate::error::Error::Client)?;
        Ok(Self { client })
    }

    /// Create a new ReqwestSender with a custom client
    pub fn with_client(client: Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl HttpSender for ReqwestSender {
    async fn send(&self, request: SendableHttpRequest) -> Result<SendableHttpResponse> {
        let mut events = Vec::new();

        // Parse the HTTP method
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|e| crate::error::Error::BodyError(format!("Invalid HTTP method: {}", e)))?;

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
                let stream = ReaderStream::new(stream);
                let body = reqwest::Body::wrap_stream(stream);
                req_builder = req_builder.body(body);
            }
        }

        let start = std::time::Instant::now();
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

        let response = self.client.execute(sendable_req).await?;
        let status = response.status().as_u16();
        events.push(HttpResponseEvent::ReceiveUrl {
            version: response.version(),
            status: response.status().to_string(),
        });

        timing.headers = start.elapsed();

        // Extract status
        let content_length = response.content_length();

        // Extract headers
        let mut headers = HashMap::new();
        for (key, value) in response.headers() {
            if let Ok(v) = value.to_str() {
                events.push(HttpResponseEvent::HeaderDown(key.to_string(), v.to_string()));
                headers.insert(key.to_string(), v.to_string());
            }
        }

        let body = response.bytes().await?.to_vec();

        timing.body = start.elapsed();

        Ok(SendableHttpResponse {
            status,
            headers,
            body,
            content_length,
            timing,
            events,
        })
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
