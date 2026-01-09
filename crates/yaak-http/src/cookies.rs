//! Custom cookie handling for HTTP requests
//!
//! This module provides cookie storage and matching functionality that was previously
//! delegated to reqwest. It implements RFC 6265 cookie domain and path matching.

use log::debug;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;
use yaak_models::models::{Cookie, CookieDomain, CookieExpires};

/// A thread-safe cookie store that can be shared across requests
#[derive(Debug, Clone)]
pub struct CookieStore {
    cookies: Arc<Mutex<Vec<Cookie>>>,
}

impl Default for CookieStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CookieStore {
    /// Create a new empty cookie store
    pub fn new() -> Self {
        Self { cookies: Arc::new(Mutex::new(Vec::new())) }
    }

    /// Create a cookie store from existing cookies
    pub fn from_cookies(cookies: Vec<Cookie>) -> Self {
        Self { cookies: Arc::new(Mutex::new(cookies)) }
    }

    /// Get all cookies (for persistence)
    pub fn get_all_cookies(&self) -> Vec<Cookie> {
        self.cookies.lock().unwrap().clone()
    }

    /// Get the Cookie header value for the given URL
    pub fn get_cookie_header(&self, url: &Url) -> Option<String> {
        let cookies = self.cookies.lock().unwrap();
        let now = SystemTime::now();

        let matching_cookies: Vec<_> = cookies
            .iter()
            .filter(|cookie| self.cookie_matches(cookie, url, &now))
            .filter_map(|cookie| {
                // Parse the raw cookie to get name=value
                parse_cookie_name_value(&cookie.raw_cookie)
            })
            .collect();

        if matching_cookies.is_empty() {
            None
        } else {
            Some(
                matching_cookies
                    .into_iter()
                    .map(|(name, value)| format!("{}={}", name, value))
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        }
    }

    /// Parse Set-Cookie headers and add cookies to the store
    pub fn store_cookies_from_response(&self, url: &Url, set_cookie_headers: &[String]) {
        let mut cookies = self.cookies.lock().unwrap();

        for header_value in set_cookie_headers {
            if let Some(cookie) = parse_set_cookie(header_value, url) {
                // Remove any existing cookie with the same name and domain
                cookies.retain(|existing| !cookies_match(existing, &cookie));
                debug!(
                    "Storing cookie: {} for domain {:?}",
                    parse_cookie_name_value(&cookie.raw_cookie)
                        .map(|(n, _)| n)
                        .unwrap_or_else(|| "unknown".to_string()),
                    cookie.domain
                );
                cookies.push(cookie);
            }
        }
    }

    /// Check if a cookie matches the given URL
    fn cookie_matches(&self, cookie: &Cookie, url: &Url, now: &SystemTime) -> bool {
        // Check expiration
        if let CookieExpires::AtUtc(expiry_str) = &cookie.expires {
            if let Ok(expiry) = parse_cookie_date(expiry_str) {
                if expiry < *now {
                    return false;
                }
            }
        }

        // Check domain
        let url_host = match url.host_str() {
            Some(h) => h.to_lowercase(),
            None => return false,
        };

        let domain_matches = match &cookie.domain {
            CookieDomain::HostOnly(domain) => url_host == domain.to_lowercase(),
            CookieDomain::Suffix(domain) => {
                let domain_lower = domain.to_lowercase();
                url_host == domain_lower || url_host.ends_with(&format!(".{}", domain_lower))
            }
            // NotPresent and Empty should never occur in practice since we always set domain
            // when parsing Set-Cookie headers. Treat as non-matching to be safe.
            CookieDomain::NotPresent | CookieDomain::Empty => false,
        };

        if !domain_matches {
            return false;
        }

        // Check path
        let (cookie_path, _) = &cookie.path;
        let url_path = url.path();

        path_matches(url_path, cookie_path)
    }
}

/// Parse name=value from a cookie string (raw_cookie format)
fn parse_cookie_name_value(raw_cookie: &str) -> Option<(String, String)> {
    // The raw_cookie typically looks like "name=value" or "name=value; attr1; attr2=..."
    let first_part = raw_cookie.split(';').next()?;
    let mut parts = first_part.splitn(2, '=');
    let name = parts.next()?.trim().to_string();
    let value = parts.next().unwrap_or("").trim().to_string();

    if name.is_empty() { None } else { Some((name, value)) }
}

/// Parse a Set-Cookie header into a Cookie
fn parse_set_cookie(header_value: &str, request_url: &Url) -> Option<Cookie> {
    let parsed = cookie::Cookie::parse(header_value).ok()?;

    let raw_cookie = format!("{}={}", parsed.name(), parsed.value());

    // Determine domain
    let domain = if let Some(domain_attr) = parsed.domain() {
        // Domain attribute present - this is a suffix match
        let domain = domain_attr.trim_start_matches('.').to_lowercase();

        // Reject single-component domains (TLDs) except localhost
        if is_single_component_domain(&domain) && !is_localhost(&domain) {
            debug!("Rejecting cookie with single-component domain: {}", domain);
            return None;
        }

        CookieDomain::Suffix(domain)
    } else {
        // No domain attribute - host-only cookie
        CookieDomain::HostOnly(request_url.host_str().unwrap_or("").to_lowercase())
    };

    // Determine expiration
    let expires = if let Some(max_age) = parsed.max_age() {
        let duration = Duration::from_secs(max_age.whole_seconds().max(0) as u64);
        let expiry = SystemTime::now() + duration;
        let expiry_secs = expiry.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        CookieExpires::AtUtc(format!("{}", expiry_secs))
    } else if let Some(expires_time) = parsed.expires() {
        match expires_time {
            cookie::Expiration::DateTime(dt) => {
                let timestamp = dt.unix_timestamp();
                CookieExpires::AtUtc(format!("{}", timestamp))
            }
            cookie::Expiration::Session => CookieExpires::SessionEnd,
        }
    } else {
        CookieExpires::SessionEnd
    };

    // Determine path
    let path = if let Some(path_attr) = parsed.path() {
        (path_attr.to_string(), true)
    } else {
        // Default path is the directory of the request URI
        let default_path = default_cookie_path(request_url.path());
        (default_path, false)
    };

    Some(Cookie { raw_cookie, domain, expires, path })
}

/// Get the default cookie path from a request path (RFC 6265 Section 5.1.4)
fn default_cookie_path(request_path: &str) -> String {
    if request_path.is_empty() || !request_path.starts_with('/') {
        return "/".to_string();
    }

    // Find the last slash
    if let Some(last_slash) = request_path.rfind('/') {
        if last_slash == 0 { "/".to_string() } else { request_path[..last_slash].to_string() }
    } else {
        "/".to_string()
    }
}

/// Check if a request path matches a cookie path (RFC 6265 Section 5.1.4)
fn path_matches(request_path: &str, cookie_path: &str) -> bool {
    if request_path == cookie_path {
        return true;
    }

    if request_path.starts_with(cookie_path) {
        // Cookie path must end with / or the char after cookie_path in request_path must be /
        if cookie_path.ends_with('/') {
            return true;
        }
        if request_path.chars().nth(cookie_path.len()) == Some('/') {
            return true;
        }
    }

    false
}

/// Check if two cookies match (same name and domain)
fn cookies_match(a: &Cookie, b: &Cookie) -> bool {
    let name_a = parse_cookie_name_value(&a.raw_cookie).map(|(n, _)| n);
    let name_b = parse_cookie_name_value(&b.raw_cookie).map(|(n, _)| n);

    if name_a != name_b {
        return false;
    }

    // Check domain match
    match (&a.domain, &b.domain) {
        (CookieDomain::HostOnly(d1), CookieDomain::HostOnly(d2)) => {
            d1.to_lowercase() == d2.to_lowercase()
        }
        (CookieDomain::Suffix(d1), CookieDomain::Suffix(d2)) => {
            d1.to_lowercase() == d2.to_lowercase()
        }
        _ => false,
    }
}

/// Parse a cookie date string (Unix timestamp in our format)
fn parse_cookie_date(date_str: &str) -> Result<SystemTime, ()> {
    let timestamp: i64 = date_str.parse().map_err(|_| ())?;
    let duration = Duration::from_secs(timestamp.max(0) as u64);
    Ok(UNIX_EPOCH + duration)
}

/// Check if a domain is a single-component domain (TLD)
/// e.g., "com", "org", "net" - domains without any dots
fn is_single_component_domain(domain: &str) -> bool {
    // Empty or only dots
    let trimmed = domain.trim_matches('.');
    if trimmed.is_empty() {
        return true;
    }
    // IPv6 addresses use colons, not dots - don't consider them single-component
    if domain.contains(':') {
        return false;
    }
    !trimmed.contains('.')
}

/// Check if a domain is localhost or a localhost variant
fn is_localhost(domain: &str) -> bool {
    let lower = domain.to_lowercase();
    lower == "localhost"
        || lower.ends_with(".localhost")
        || lower == "127.0.0.1"
        || lower == "::1"
        || lower == "[::1]"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cookie_name_value() {
        assert_eq!(
            parse_cookie_name_value("session=abc123"),
            Some(("session".to_string(), "abc123".to_string()))
        );
        assert_eq!(
            parse_cookie_name_value("name=value; Path=/; HttpOnly"),
            Some(("name".to_string(), "value".to_string()))
        );
        assert_eq!(parse_cookie_name_value("empty="), Some(("empty".to_string(), "".to_string())));
        assert_eq!(parse_cookie_name_value(""), None);
    }

    #[test]
    fn test_path_matches() {
        assert!(path_matches("/", "/"));
        assert!(path_matches("/foo", "/"));
        assert!(path_matches("/foo/bar", "/foo"));
        assert!(path_matches("/foo/bar", "/foo/"));
        assert!(!path_matches("/foobar", "/foo"));
        assert!(!path_matches("/foo", "/foo/bar"));
    }

    #[test]
    fn test_default_cookie_path() {
        assert_eq!(default_cookie_path("/"), "/");
        assert_eq!(default_cookie_path("/foo"), "/");
        assert_eq!(default_cookie_path("/foo/bar"), "/foo");
        assert_eq!(default_cookie_path("/foo/bar/baz"), "/foo/bar");
        assert_eq!(default_cookie_path(""), "/");
    }

    #[test]
    fn test_cookie_store_basic() {
        let store = CookieStore::new();
        let url = Url::parse("https://example.com/path").unwrap();

        // Initially empty
        assert!(store.get_cookie_header(&url).is_none());

        // Add a cookie
        store.store_cookies_from_response(&url, &["session=abc123".to_string()]);

        // Should now have the cookie
        let header = store.get_cookie_header(&url);
        assert_eq!(header, Some("session=abc123".to_string()));
    }

    #[test]
    fn test_cookie_domain_matching() {
        let store = CookieStore::new();
        let url = Url::parse("https://example.com/").unwrap();

        // Cookie with domain attribute (suffix match)
        store.store_cookies_from_response(
            &url,
            &["domain_cookie=value; Domain=example.com".to_string()],
        );

        // Should match example.com
        assert!(store.get_cookie_header(&url).is_some());

        // Should match subdomain
        let subdomain_url = Url::parse("https://sub.example.com/").unwrap();
        assert!(store.get_cookie_header(&subdomain_url).is_some());

        // Should not match different domain
        let other_url = Url::parse("https://other.com/").unwrap();
        assert!(store.get_cookie_header(&other_url).is_none());
    }

    #[test]
    fn test_cookie_path_matching() {
        let store = CookieStore::new();
        let url = Url::parse("https://example.com/api/v1").unwrap();

        // Cookie with path
        store.store_cookies_from_response(&url, &["api_cookie=value; Path=/api".to_string()]);

        // Should match /api/v1
        assert!(store.get_cookie_header(&url).is_some());

        // Should match /api
        let api_url = Url::parse("https://example.com/api").unwrap();
        assert!(store.get_cookie_header(&api_url).is_some());

        // Should not match /other
        let other_url = Url::parse("https://example.com/other").unwrap();
        assert!(store.get_cookie_header(&other_url).is_none());
    }

    #[test]
    fn test_cookie_replacement() {
        let store = CookieStore::new();
        let url = Url::parse("https://example.com/").unwrap();

        // Add a cookie
        store.store_cookies_from_response(&url, &["session=old".to_string()]);
        assert_eq!(store.get_cookie_header(&url), Some("session=old".to_string()));

        // Replace with new value
        store.store_cookies_from_response(&url, &["session=new".to_string()]);
        assert_eq!(store.get_cookie_header(&url), Some("session=new".to_string()));

        // Should only have one cookie
        assert_eq!(store.get_all_cookies().len(), 1);
    }

    #[test]
    fn test_is_single_component_domain() {
        // Single-component domains (TLDs)
        assert!(is_single_component_domain("com"));
        assert!(is_single_component_domain("org"));
        assert!(is_single_component_domain("net"));
        assert!(is_single_component_domain("localhost")); // Still single-component, but allowed separately

        // Multi-component domains
        assert!(!is_single_component_domain("example.com"));
        assert!(!is_single_component_domain("sub.example.com"));
        assert!(!is_single_component_domain("co.uk"));

        // Edge cases
        assert!(is_single_component_domain("")); // Empty is treated as single-component
        assert!(is_single_component_domain(".")); // Only dots
        assert!(is_single_component_domain("..")); // Only dots

        // IPv6 addresses (have colons, not dots)
        assert!(!is_single_component_domain("::1")); // IPv6 localhost
        assert!(!is_single_component_domain("[::1]")); // Bracketed IPv6
        assert!(!is_single_component_domain("2001:db8::1")); // IPv6 address
    }

    #[test]
    fn test_is_localhost() {
        // Localhost variants
        assert!(is_localhost("localhost"));
        assert!(is_localhost("LOCALHOST")); // Case-insensitive
        assert!(is_localhost("sub.localhost"));
        assert!(is_localhost("app.sub.localhost"));

        // IP localhost
        assert!(is_localhost("127.0.0.1"));
        assert!(is_localhost("::1"));
        assert!(is_localhost("[::1]"));

        // Not localhost
        assert!(!is_localhost("example.com"));
        assert!(!is_localhost("localhost.com")); // .com domain, not localhost
        assert!(!is_localhost("notlocalhost"));
    }

    #[test]
    fn test_reject_tld_cookies() {
        let store = CookieStore::new();
        let url = Url::parse("https://example.com/").unwrap();

        // Try to set a cookie with Domain=com (TLD)
        store.store_cookies_from_response(&url, &["bad=cookie; Domain=com".to_string()]);

        // Should be rejected - no cookies stored
        assert_eq!(store.get_all_cookies().len(), 0);
        assert!(store.get_cookie_header(&url).is_none());
    }

    #[test]
    fn test_allow_localhost_cookies() {
        let store = CookieStore::new();
        let url = Url::parse("http://localhost:3000/").unwrap();

        // Cookie with Domain=localhost should be allowed
        store.store_cookies_from_response(&url, &["session=abc; Domain=localhost".to_string()]);

        // Should be accepted
        assert_eq!(store.get_all_cookies().len(), 1);
        assert!(store.get_cookie_header(&url).is_some());
    }

    #[test]
    fn test_allow_127_0_0_1_cookies() {
        let store = CookieStore::new();
        let url = Url::parse("http://127.0.0.1:8080/").unwrap();

        // Cookie without Domain attribute (host-only) should work
        store.store_cookies_from_response(&url, &["session=xyz".to_string()]);

        // Should be accepted
        assert_eq!(store.get_all_cookies().len(), 1);
        assert!(store.get_cookie_header(&url).is_some());
    }

    #[test]
    fn test_allow_normal_domain_cookies() {
        let store = CookieStore::new();
        let url = Url::parse("https://example.com/").unwrap();

        // Cookie with valid domain should be allowed
        store.store_cookies_from_response(&url, &["session=abc; Domain=example.com".to_string()]);

        // Should be accepted
        assert_eq!(store.get_all_cookies().len(), 1);
        assert!(store.get_cookie_header(&url).is_some());
    }
}
