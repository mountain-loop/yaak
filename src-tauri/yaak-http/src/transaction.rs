use crate::cookies::CookieStore;
use crate::error::Result;
use crate::sender::{HttpResponse, HttpResponseEvent, HttpSender, RedirectBehavior};
use crate::types::SendableHttpRequest;
use log::debug;
use tokio::sync::mpsc;
use tokio::sync::watch::Receiver;
use url::Url;

/// HTTP Transaction that manages the lifecycle of a request, including redirect handling
pub struct HttpTransaction<S: HttpSender> {
    sender: S,
    max_redirects: usize,
    cookie_store: Option<CookieStore>,
}

impl<S: HttpSender> HttpTransaction<S> {
    /// Create a new transaction with default settings
    pub fn new(sender: S) -> Self {
        Self { sender, max_redirects: 10, cookie_store: None }
    }

    /// Create a new transaction with custom max redirects
    pub fn with_max_redirects(sender: S, max_redirects: usize) -> Self {
        Self { sender, max_redirects, cookie_store: None }
    }

    /// Create a new transaction with a cookie store
    pub fn with_cookie_store(sender: S, cookie_store: CookieStore) -> Self {
        Self { sender, max_redirects: 10, cookie_store: Some(cookie_store) }
    }

    /// Create a new transaction with custom max redirects and a cookie store
    pub fn with_options(
        sender: S,
        max_redirects: usize,
        cookie_store: Option<CookieStore>,
    ) -> Self {
        Self { sender, max_redirects, cookie_store }
    }

    /// Execute the request with cancellation support.
    /// Returns an HttpResponse with unconsumed body - caller decides how to consume it.
    /// Events are sent through the provided channel.
    pub async fn execute_with_cancellation(
        &self,
        request: SendableHttpRequest,
        mut cancelled_rx: Receiver<bool>,
        event_tx: mpsc::Sender<HttpResponseEvent>,
    ) -> Result<HttpResponse> {
        let mut redirect_count = 0;
        let mut current_url = request.url;
        let mut current_method = request.method;
        let mut current_headers = request.headers;
        let mut current_body = request.body;

        // Helper to send events (ignores errors if receiver is dropped or channel is full)
        let send_event = |event: HttpResponseEvent| {
            let _ = event_tx.try_send(event);
        };

        loop {
            // Check for cancellation before each request
            if *cancelled_rx.borrow() {
                return Err(crate::error::Error::RequestCanceledError);
            }

            // Inject cookies into headers if we have a cookie store
            let headers_with_cookies = if let Some(cookie_store) = &self.cookie_store {
                let mut headers = current_headers.clone();
                if let Ok(url) = Url::parse(&current_url) {
                    if let Some(cookie_header) = cookie_store.get_cookie_header(&url) {
                        debug!("Injecting Cookie header: {}", cookie_header);
                        // Check if there's already a Cookie header and merge if so
                        if let Some(existing) =
                            headers.iter_mut().find(|h| h.0.eq_ignore_ascii_case("cookie"))
                        {
                            existing.1 = format!("{}; {}", existing.1, cookie_header);
                        } else {
                            headers.push(("Cookie".to_string(), cookie_header));
                        }
                    }
                }
                headers
            } else {
                current_headers.clone()
            };

            // Build request for this iteration
            let req = SendableHttpRequest {
                url: current_url.clone(),
                method: current_method.clone(),
                headers: headers_with_cookies,
                body: current_body,
                options: request.options.clone(),
            };

            // Send the request
            send_event(HttpResponseEvent::Setting(
                "redirects".to_string(),
                request.options.follow_redirects.to_string(),
            ));

            // Execute with cancellation support
            let response = tokio::select! {
                result = self.sender.send(req, event_tx.clone()) => result?,
                _ = cancelled_rx.changed() => {
                    return Err(crate::error::Error::RequestCanceledError);
                }
            };

            // Parse Set-Cookie headers and store cookies
            if let Some(cookie_store) = &self.cookie_store {
                if let Ok(url) = Url::parse(&current_url) {
                    let set_cookie_headers: Vec<String> = response
                        .headers
                        .iter()
                        .filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
                        .map(|(_, v)| v.clone())
                        .collect();

                    if !set_cookie_headers.is_empty() {
                        debug!("Storing {} cookies from response", set_cookie_headers.len());
                        cookie_store.store_cookies_from_response(&url, &set_cookie_headers);
                    }
                }
            }

            if !Self::is_redirect(response.status) {
                // Not a redirect - return the response for caller to consume body
                return Ok(response);
            }

            if !request.options.follow_redirects {
                // Redirects disabled - return the redirect response as-is
                return Ok(response);
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
            // HTTP headers are case-insensitive, so we need to search for any casing
            let location = response
                .headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("location"))
                .map(|(_, v)| v.clone())
                .ok_or_else(|| {
                    crate::error::Error::RequestError(
                        "Redirect response missing Location header".to_string(),
                    )
                })?;

            // Also get status before draining
            let status = response.status;

            send_event(HttpResponseEvent::Info("Ignoring the response body".to_string()));

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

            // Determine redirect behavior based on status code and method
            let behavior = if status == 303 {
                // 303 See Other always changes to GET
                RedirectBehavior::DropBody
            } else if (status == 301 || status == 302) && current_method == "POST" {
                // For 301/302, change POST to GET (common browser behavior)
                RedirectBehavior::DropBody
            } else {
                // For 307 and 308, the method and body are preserved
                // Also for 301/302 with non-POST methods
                RedirectBehavior::Preserve
            };

            send_event(HttpResponseEvent::Redirect {
                url: current_url.clone(),
                status,
                behavior: behavior.clone(),
            });

            // Handle method changes for certain redirect codes
            if matches!(behavior, RedirectBehavior::DropBody) {
                if current_method != "GET" {
                    current_method = "GET".to_string();
                }
                // Remove content-related headers
                current_headers.retain(|h| {
                    let name_lower = h.0.to_lowercase();
                    !name_lower.starts_with("content-") && name_lower != "transfer-encoding"
                });
            }

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
    use crate::sender::{HttpResponseEvent, HttpSender};
    use async_trait::async_trait;
    use std::collections::HashMap;
    use std::pin::Pin;
    use std::sync::Arc;
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
            _event_tx: mpsc::Sender<HttpResponseEvent>,
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
                    HashMap::new(),
                    None,                              // content_length
                    "https://example.com".to_string(), // url
                    None,                              // remote_addr
                    Some("HTTP/1.1".to_string()),      // version
                    body_stream,
                    ContentEncoding::Identity,
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
        let (event_tx, _event_rx) = mpsc::channel(100);
        let result = transaction.execute_with_cancellation(request, rx, event_tx).await.unwrap();
        assert_eq!(result.status, 200);

        // Consume the body to verify it
        let (body, _) = result.bytes().await.unwrap();
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
        let (event_tx, _event_rx) = mpsc::channel(100);
        let result = transaction.execute_with_cancellation(request, rx, event_tx).await.unwrap();
        assert_eq!(result.status, 200);

        let (body, _) = result.bytes().await.unwrap();
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
        let (event_tx, _event_rx) = mpsc::channel(100);
        let result = transaction.execute_with_cancellation(request, rx, event_tx).await;
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

    #[tokio::test]
    async fn test_cookie_injection() {
        // Create a mock sender that verifies the Cookie header was injected
        struct CookieVerifyingSender {
            expected_cookie: String,
        }

        #[async_trait]
        impl HttpSender for CookieVerifyingSender {
            async fn send(
                &self,
                request: SendableHttpRequest,
                _event_tx: mpsc::Sender<HttpResponseEvent>,
            ) -> Result<HttpResponse> {
                // Verify the Cookie header was injected
                let cookie_header =
                    request.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("cookie"));

                assert!(cookie_header.is_some(), "Cookie header should be present");
                assert!(
                    cookie_header.unwrap().1.contains(&self.expected_cookie),
                    "Cookie header should contain expected value"
                );

                let body_stream: Pin<Box<dyn AsyncRead + Send>> =
                    Box::pin(std::io::Cursor::new(vec![]));
                Ok(HttpResponse::new(
                    200,
                    None,
                    HashMap::new(),
                    HashMap::new(),
                    None,
                    "https://example.com".to_string(),
                    None,
                    Some("HTTP/1.1".to_string()),
                    body_stream,
                    ContentEncoding::Identity,
                ))
            }
        }

        use yaak_models::models::{Cookie, CookieDomain, CookieExpires};

        // Create a cookie store with a test cookie
        let cookie = Cookie {
            raw_cookie: "session=abc123".to_string(),
            domain: CookieDomain::HostOnly("example.com".to_string()),
            expires: CookieExpires::SessionEnd,
            path: ("/".to_string(), false),
        };
        let cookie_store = CookieStore::from_cookies(vec![cookie]);

        let sender = CookieVerifyingSender { expected_cookie: "session=abc123".to_string() };
        let transaction = HttpTransaction::with_cookie_store(sender, cookie_store);

        let request = SendableHttpRequest {
            url: "https://example.com/api".to_string(),
            method: "GET".to_string(),
            headers: vec![],
            ..Default::default()
        };

        let (_tx, rx) = tokio::sync::watch::channel(false);
        let (event_tx, _event_rx) = mpsc::channel(100);
        let result = transaction.execute_with_cancellation(request, rx, event_tx).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_set_cookie_parsing() {
        // Create a cookie store
        let cookie_store = CookieStore::new();

        // Mock sender that returns a Set-Cookie header
        struct SetCookieSender;

        #[async_trait]
        impl HttpSender for SetCookieSender {
            async fn send(
                &self,
                _request: SendableHttpRequest,
                _event_tx: mpsc::Sender<HttpResponseEvent>,
            ) -> Result<HttpResponse> {
                let mut headers = HashMap::new();
                headers.insert("set-cookie".to_string(), "session=xyz789; Path=/".to_string());

                let body_stream: Pin<Box<dyn AsyncRead + Send>> =
                    Box::pin(std::io::Cursor::new(vec![]));
                Ok(HttpResponse::new(
                    200,
                    None,
                    headers,
                    HashMap::new(),
                    None,
                    "https://example.com".to_string(),
                    None,
                    Some("HTTP/1.1".to_string()),
                    body_stream,
                    ContentEncoding::Identity,
                ))
            }
        }

        let sender = SetCookieSender;
        let transaction = HttpTransaction::with_cookie_store(sender, cookie_store.clone());

        let request = SendableHttpRequest {
            url: "https://example.com/login".to_string(),
            method: "POST".to_string(),
            headers: vec![],
            ..Default::default()
        };

        let (_tx, rx) = tokio::sync::watch::channel(false);
        let (event_tx, _event_rx) = mpsc::channel(100);
        let result = transaction.execute_with_cancellation(request, rx, event_tx).await;
        assert!(result.is_ok());

        // Verify the cookie was stored
        let cookies = cookie_store.get_all_cookies();
        assert_eq!(cookies.len(), 1);
        assert!(cookies[0].raw_cookie.contains("session=xyz789"));
    }

    #[tokio::test]
    async fn test_cookies_across_redirects() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        // Create a cookie store
        let cookie_store = CookieStore::new();

        // Track request count
        let request_count = Arc::new(AtomicUsize::new(0));
        let request_count_clone = request_count.clone();

        struct RedirectWithCookiesSender {
            request_count: Arc<AtomicUsize>,
        }

        #[async_trait]
        impl HttpSender for RedirectWithCookiesSender {
            async fn send(
                &self,
                request: SendableHttpRequest,
                _event_tx: mpsc::Sender<HttpResponseEvent>,
            ) -> Result<HttpResponse> {
                let count = self.request_count.fetch_add(1, Ordering::SeqCst);

                let (status, headers) = if count == 0 {
                    // First request: return redirect with Set-Cookie
                    let mut h = HashMap::new();
                    h.insert("location".to_string(), "https://example.com/final".to_string());
                    h.insert("set-cookie".to_string(), "redirect_cookie=value1".to_string());
                    (302, h)
                } else {
                    // Second request: verify cookie was sent
                    let cookie_header =
                        request.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("cookie"));

                    assert!(cookie_header.is_some(), "Cookie header should be present on redirect");
                    assert!(
                        cookie_header.unwrap().1.contains("redirect_cookie=value1"),
                        "Redirect cookie should be included"
                    );

                    (200, HashMap::new())
                };

                let body_stream: Pin<Box<dyn AsyncRead + Send>> =
                    Box::pin(std::io::Cursor::new(vec![]));
                Ok(HttpResponse::new(
                    status,
                    None,
                    headers,
                    HashMap::new(),
                    None,
                    "https://example.com".to_string(),
                    None,
                    Some("HTTP/1.1".to_string()),
                    body_stream,
                    ContentEncoding::Identity,
                ))
            }
        }

        let sender = RedirectWithCookiesSender { request_count: request_count_clone };
        let transaction = HttpTransaction::with_cookie_store(sender, cookie_store);

        let request = SendableHttpRequest {
            url: "https://example.com/start".to_string(),
            method: "GET".to_string(),
            headers: vec![],
            options: crate::types::SendableHttpRequestOptions {
                follow_redirects: true,
                ..Default::default()
            },
            ..Default::default()
        };

        let (_tx, rx) = tokio::sync::watch::channel(false);
        let (event_tx, _event_rx) = mpsc::channel(100);
        let result = transaction.execute_with_cancellation(request, rx, event_tx).await;
        assert!(result.is_ok());
        assert_eq!(request_count.load(Ordering::SeqCst), 2);
    }
}
