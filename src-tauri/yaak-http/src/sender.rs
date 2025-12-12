use crate::error::Result;
use crate::types::{SendableBodyPlain, SendableHttpRequest};
use async_trait::async_trait;
use reqwest::{Client, Method};
use std::collections::HashMap;
use std::time::Duration;
use tokio_util::io::ReaderStream;

#[derive(Debug, Default)]
pub struct HttpResponseTiming {
    pub headers: Duration,
    pub body: Duration,
}

/// Basic response type for HTTP responses
#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
    pub content_length: Option<u64>,
    pub timing: HttpResponseTiming,
}

/// Trait for sending HTTP requests
#[async_trait]
pub trait HttpSender: Send + Sync {
    /// Send an HTTP request and return the response
    async fn send(&self, request: SendableHttpRequest) -> Result<HttpResponse>;
}

/// Reqwest-based implementation of HttpSender
pub struct ReqwestSender {
    client: Client,
}

impl ReqwestSender {
    /// Create a new ReqwestSender with a default client
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .build()
            .map_err(crate::error::Error::Client)?;
        Ok(Self { client })
    }

    /// Create a new ReqwestSender with a custom client
    pub fn with_client(client: Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl HttpSender for ReqwestSender {
    async fn send(&self, request: SendableHttpRequest) -> Result<HttpResponse> {
        // Parse the HTTP method
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|e| crate::error::Error::BodyError(format!("Invalid HTTP method: {}", e)))?;

        // Build the request
        let mut req_builder = self.client.request(method, &request.url);

        // Add headers
        for header in request.headers {
            req_builder = req_builder.header(&header.0, &header.1);
        }

        // Add body
        match request.body {
            SendableBodyPlain::None => {
                // No request body
            }
            SendableBodyPlain::Bytes(bytes) => {
                req_builder = req_builder.body(bytes);
            }
            SendableBodyPlain::Stream(stream) => {
                // Convert AsyncRead stream to reqwest Body
                let stream = ReaderStream::new(stream);
                let body = reqwest::Body::wrap_stream(stream);
                req_builder = req_builder.body(body);
            }
        }

        let start = std::time::Instant::now();
        let mut timing = HttpResponseTiming::default();

        // Send the request
        let response = req_builder.send().await?;

        timing.headers = start.elapsed();

        // Extract status
        let status = response.status().as_u16();
        let content_length = response.content_length();

        // Extract headers
        let mut headers = HashMap::new();
        for (key, value) in response.headers() {
            if let Ok(v) = value.to_str() {
                headers.insert(key.to_string(), v.to_string());
            }
        }

        let body = response.bytes().await?.to_vec();

        timing.body = start.elapsed();

        Ok(HttpResponse {
            status,
            headers,
            body,
            content_length,
            timing,
        })
    }
}
