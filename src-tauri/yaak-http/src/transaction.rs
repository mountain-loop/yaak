use crate::error::Result;
use crate::sender::{HttpResponse, HttpResponseEvent, HttpSender};
use crate::types::SendableHttpRequest;
use tokio::sync::watch::Receiver;

/// HTTP Transaction that manages the lifecycle of a request, including redirect handling
pub struct HttpTransaction<S: HttpSender> {
    sender: S,
    max_redirects: usize,
}

impl<S: HttpSender> HttpTransaction<S> {
    /// Create a new transaction with default settings
    pub fn new(sender: S) -> Self {
        Self { sender, max_redirects: 10 }
    }

    /// Create a new transaction with custom max redirects
    pub fn with_max_redirects(sender: S, max_redirects: usize) -> Self {
        Self { sender, max_redirects }
    }

    /// Execute the request with cancellation support.
    /// Returns an HttpResponse with unconsumed body - caller decides how to consume it.
    pub async fn execute_with_cancellation(
        &self,
        request: SendableHttpRequest,
        mut cancelled_rx: Receiver<bool>,
    ) -> Result<(HttpResponse, Vec<HttpResponseEvent>)> {
        let mut redirect_count = 0;
        let mut current_url = request.url;
        let mut current_method = request.method;
        let mut current_headers = request.headers;
        let mut current_body = request.body;
        let mut events = Vec::new();

        loop {
            // Check for cancellation before each request
            if *cancelled_rx.borrow() {
                return Err(crate::error::Error::RequestCanceledError);
            }

            // Build request for this iteration
            let req = SendableHttpRequest {
                url: current_url.clone(),
                method: current_method.clone(),
                headers: current_headers.clone(),
                body: current_body,
                options: request.options.clone(),
            };

            // Send the request
            events.push(HttpResponseEvent::Setting(
                "redirects".to_string(),
                request.options.follow_redirects.to_string(),
            ));

            // Execute with cancellation support
            let response = tokio::select! {
                result = self.sender.send(req, &mut events) => result?,
                _ = cancelled_rx.changed() => {
                    return Err(crate::error::Error::RequestCanceledError);
                }
            };

            if !Self::is_redirect(response.status) {
                // Not a redirect - return the response for caller to consume body
                return Ok((response, events));
            }

            if !request.options.follow_redirects {
                // Redirects disabled - return the redirect response as-is
                return Ok((response, events));
            }

            // Check if we've exceeded max redirects
            if redirect_count >= self.max_redirects {
                // Drain the response before returning error
                let _ = response.drain().await;
                return Err(crate::error::Error::RequestError(format!(
                    "Maximum redirect limit ({}) exceeded",
                    self.max_redirects
                )));
            }

            // Extract Location header before draining (headers are available immediately)
            let location = response
                .headers
                .get("location")
                .or_else(|| response.headers.get("Location"))
                .cloned()
                .ok_or_else(|| {
                    crate::error::Error::RequestError(
                        "Redirect response missing Location header".to_string(),
                    )
                })?;

            // Also get status before draining
            let status = response.status;

            events.push(HttpResponseEvent::Info("Ignoring the response body".to_string()));

            // Drain the redirect response body before following
            response.drain().await?;

            // Update the request URL
            current_url = if location.starts_with("http://") || location.starts_with("https://") {
                // Absolute URL
                location
            } else if location.starts_with('/') {
                // Absolute path - need to extract base URL from current request
                let base_url = Self::extract_base_url(&current_url)?;
                format!("{}{}", base_url, location)
            } else {
                // Relative path - need to resolve relative to current path
                let base_path = Self::extract_base_path(&current_url)?;
                format!("{}/{}", base_path, location)
            };

            events.push(HttpResponseEvent::Info(format!(
                "Issuing redirect {} to: {}",
                redirect_count + 1,
                current_url
            )));

            // Handle method changes for certain redirect codes
            if status == 303 {
                // 303 See Other always changes to GET
                if current_method != "GET" {
                    current_method = "GET".to_string();
                    events.push(HttpResponseEvent::Info("Changing method to GET".to_string()));
                }
                // Remove content-related headers
                current_headers.retain(|h| {
                    let name_lower = h.0.to_lowercase();
                    !name_lower.starts_with("content-") && name_lower != "transfer-encoding"
                });
            } else if status == 301 || status == 302 {
                // For 301/302, change POST to GET (common browser behavior)
                // but keep other methods as-is
                if current_method == "POST" {
                    events.push(HttpResponseEvent::Info("Changing method to GET".to_string()));
                    current_method = "GET".to_string();
                    // Remove content-related headers
                    current_headers.retain(|h| {
                        let name_lower = h.0.to_lowercase();
                        !name_lower.starts_with("content-") && name_lower != "transfer-encoding"
                    });
                }
            }
            // For 307 and 308, the method and body are preserved

            // Reset body for next iteration (since it was moved in the send call)
            // For redirects that change method to GET or for all redirects since body was consumed
            current_body = None;

            redirect_count += 1;
        }
    }

    /// Check if a status code indicates a redirect
    fn is_redirect(status: u16) -> bool {
        matches!(status, 301 | 302 | 303 | 307 | 308)
    }

    /// Extract the base URL (scheme + host) from a full URL
    fn extract_base_url(url: &str) -> Result<String> {
        // Find the position after "://"
        let scheme_end = url.find("://").ok_or_else(|| {
            crate::error::Error::RequestError(format!("Invalid URL format: {}", url))
        })?;

        // Find the first '/' after the scheme
        let path_start = url[scheme_end + 3..].find('/');

        if let Some(idx) = path_start {
            Ok(url[..scheme_end + 3 + idx].to_string())
        } else {
            // No path, return entire URL
            Ok(url.to_string())
        }
    }

    /// Extract the base path (everything except the last segment) from a URL
    fn extract_base_path(url: &str) -> Result<String> {
        if let Some(last_slash) = url.rfind('/') {
            // Don't include the trailing slash if it's part of the host
            if url[..last_slash].ends_with("://") || url[..last_slash].ends_with(':') {
                Ok(url.to_string())
            } else {
                Ok(url[..last_slash].to_string())
            }
        } else {
            Ok(url.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decompress::ContentEncoding;
    use crate::sender::{HttpResponseEvent, HttpResponseTiming, HttpSender};
    use async_trait::async_trait;
    use std::collections::HashMap;
    use std::pin::Pin;
    use std::sync::Arc;
    use std::time::Instant;
    use tokio::io::AsyncRead;
    use tokio::sync::Mutex;

    /// Mock sender for testing
    struct MockSender {
        responses: Arc<Mutex<Vec<MockResponse>>>,
    }

    struct MockResponse {
        status: u16,
        headers: HashMap<String, String>,
        body: Vec<u8>,
    }

    impl MockSender {
        fn new(responses: Vec<MockResponse>) -> Self {
            Self { responses: Arc::new(Mutex::new(responses)) }
        }
    }

    #[async_trait]
    impl HttpSender for MockSender {
        async fn send(
            &self,
            _request: SendableHttpRequest,
            _events: &mut Vec<HttpResponseEvent>,
        ) -> Result<HttpResponse> {
            let mut responses = self.responses.lock().await;
            if responses.is_empty() {
                Err(crate::error::Error::RequestError("No more mock responses".to_string()))
            } else {
                let mock = responses.remove(0);
                // Create a simple in-memory stream from the body
                let body_stream: Pin<Box<dyn AsyncRead + Send>> =
                    Box::pin(std::io::Cursor::new(mock.body));
                Ok(HttpResponse::new(
                    mock.status,
                    None, // status_reason
                    mock.headers,
                    None,                              // content_length
                    "https://example.com".to_string(), // url
                    None,                              // remote_addr
                    Some("HTTP/1.1".to_string()),      // version
                    HttpResponseTiming::default(),
                    body_stream,
                    ContentEncoding::Identity,
                    Instant::now(),
                ))
            }
        }
    }

    #[tokio::test]
    async fn test_transaction_no_redirect() {
        let response = MockResponse { status: 200, headers: HashMap::new(), body: b"OK".to_vec() };
        let sender = MockSender::new(vec![response]);
        let transaction = HttpTransaction::new(sender);

        let request = SendableHttpRequest {
            url: "https://example.com".to_string(),
            method: "GET".to_string(),
            headers: vec![],
            ..Default::default()
        };

        let (_tx, rx) = tokio::sync::watch::channel(false);
        let (result, _) = transaction.execute_with_cancellation(request, rx).await.unwrap();
        assert_eq!(result.status, 200);

        // Consume the body to verify it
        let (body, _, _) = result.bytes().await.unwrap();
        assert_eq!(body, b"OK");
    }

    #[tokio::test]
    async fn test_transaction_single_redirect() {
        let mut redirect_headers = HashMap::new();
        redirect_headers.insert("Location".to_string(), "https://example.com/new".to_string());

        let responses = vec![
            MockResponse { status: 302, headers: redirect_headers, body: vec![] },
            MockResponse { status: 200, headers: HashMap::new(), body: b"Final".to_vec() },
        ];

        let sender = MockSender::new(responses);
        let transaction = HttpTransaction::new(sender);

        let request = SendableHttpRequest {
            url: "https://example.com/old".to_string(),
            method: "GET".to_string(),
            options: crate::types::SendableHttpRequestOptions {
                follow_redirects: true,
                ..Default::default()
            },
            ..Default::default()
        };

        let (_tx, rx) = tokio::sync::watch::channel(false);
        let (result, _) = transaction.execute_with_cancellation(request, rx).await.unwrap();
        assert_eq!(result.status, 200);

        let (body, _, _) = result.bytes().await.unwrap();
        assert_eq!(body, b"Final");
    }

    #[tokio::test]
    async fn test_transaction_max_redirects_exceeded() {
        let mut redirect_headers = HashMap::new();
        redirect_headers.insert("Location".to_string(), "https://example.com/loop".to_string());

        // Create more redirects than allowed
        let responses: Vec<MockResponse> = (0..12)
            .map(|_| MockResponse { status: 302, headers: redirect_headers.clone(), body: vec![] })
            .collect();

        let sender = MockSender::new(responses);
        let transaction = HttpTransaction::with_max_redirects(sender, 10);

        let request = SendableHttpRequest {
            url: "https://example.com/start".to_string(),
            method: "GET".to_string(),
            options: crate::types::SendableHttpRequestOptions {
                follow_redirects: true,
                ..Default::default()
            },
            ..Default::default()
        };

        let (_tx, rx) = tokio::sync::watch::channel(false);
        let result = transaction.execute_with_cancellation(request, rx).await;
        if let Err(crate::error::Error::RequestError(msg)) = result {
            assert!(msg.contains("Maximum redirect limit"));
        } else {
            panic!("Expected RequestError with max redirect message. Got {result:?}");
        }
    }

    #[test]
    fn test_is_redirect() {
        assert!(HttpTransaction::<MockSender>::is_redirect(301));
        assert!(HttpTransaction::<MockSender>::is_redirect(302));
        assert!(HttpTransaction::<MockSender>::is_redirect(303));
        assert!(HttpTransaction::<MockSender>::is_redirect(307));
        assert!(HttpTransaction::<MockSender>::is_redirect(308));
        assert!(!HttpTransaction::<MockSender>::is_redirect(200));
        assert!(!HttpTransaction::<MockSender>::is_redirect(404));
        assert!(!HttpTransaction::<MockSender>::is_redirect(500));
    }

    #[test]
    fn test_extract_base_url() {
        let result =
            HttpTransaction::<MockSender>::extract_base_url("https://example.com/path/to/resource");
        assert_eq!(result.unwrap(), "https://example.com");

        let result = HttpTransaction::<MockSender>::extract_base_url("http://localhost:8080/api");
        assert_eq!(result.unwrap(), "http://localhost:8080");

        let result = HttpTransaction::<MockSender>::extract_base_url("invalid-url");
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_base_path() {
        let result = HttpTransaction::<MockSender>::extract_base_path(
            "https://example.com/path/to/resource",
        );
        assert_eq!(result.unwrap(), "https://example.com/path/to");

        let result = HttpTransaction::<MockSender>::extract_base_path("https://example.com/single");
        assert_eq!(result.unwrap(), "https://example.com");

        let result = HttpTransaction::<MockSender>::extract_base_path("https://example.com/");
        assert_eq!(result.unwrap(), "https://example.com");
    }
}
