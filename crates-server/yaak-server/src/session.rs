//! What the connected tab is currently looking at.
//!
//! The desktop reads workspace, environment, cookie jar and request straight off
//! the window's URL (crates-tauri/yaak-tauri-utils/src/window.rs). A browser tab
//! runs the same router and so has the same URL, but the server cannot see it —
//! so the tab reports it, on connect and whenever it changes, and the same
//! parsing happens here.
//!
//! One session for the whole process: this slice serves a single tab. A second
//! tab overwrites the first's context rather than getting its own.

use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Default)]
pub struct SessionContext {
    /// Identifies the tab, and lands in `UpdateSource::Window { label }` so
    /// model-write echo suppression works exactly as it does on the desktop.
    pub label: String,
    pub url: String,
}

impl SessionContext {
    pub fn workspace_id(&self) -> Option<String> {
        let rest = self.url.split("/workspaces/").nth(1)?;
        let id: String =
            rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        if id.is_empty() { None } else { Some(id) }
    }

    pub fn request_id(&self) -> Option<String> {
        let rest = self.url.split("/requests/").nth(1)?;
        let id: String =
            rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        if id.is_empty() { None } else { Some(id) }
    }

    pub fn environment_id(&self) -> Option<String> {
        self.query_param("environment_id")
    }

    pub fn cookie_jar_id(&self) -> Option<String> {
        self.query_param("cookie_jar_id")
    }

    fn query_param(&self, key: &str) -> Option<String> {
        let query = self.url.split('?').nth(1)?;
        let value = query.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            if k != key {
                return None;
            }
            Some(percent_decode(v))
        })?;

        // The router writes `environment_id=null` when nothing is selected.
        // Neither of these is an id, and treating them as one sends a lookup
        // for a model that cannot exist.
        if value.is_empty() || value == "null" || value == "undefined" {
            return None;
        }
        Some(value)
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.replace('+', " ").into_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[derive(Clone, Default)]
pub struct SessionStore {
    inner: Arc<RwLock<SessionContext>>,
}

impl SessionStore {
    pub fn get(&self) -> SessionContext {
        match self.inner.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    pub fn set(&self, context: SessionContext) {
        let mut guard = match self.inner.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = context;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(url: &str) -> SessionContext {
        SessionContext { label: "tab".into(), url: url.into() }
    }

    #[test]
    fn parses_ids_from_a_router_url() {
        let c = ctx(
            "http://localhost:1472/workspaces/wk_abc123/requests/rq_def456?environment_id=ev_1&cookie_jar_id=cj_2",
        );
        assert_eq!(c.workspace_id().as_deref(), Some("wk_abc123"));
        assert_eq!(c.request_id().as_deref(), Some("rq_def456"));
        assert_eq!(c.environment_id().as_deref(), Some("ev_1"));
        assert_eq!(c.cookie_jar_id().as_deref(), Some("cj_2"));
    }

    #[test]
    fn placeholder_query_values_are_not_ids() {
        let c = ctx("http://localhost:1472/workspaces/wk_a?environment_id=null&cookie_jar_id=");
        assert_eq!(c.environment_id(), None);
        assert_eq!(c.cookie_jar_id(), None);
    }

    #[test]
    fn missing_parts_are_none() {
        let c = ctx("http://localhost:1472/");
        assert_eq!(c.workspace_id(), None);
        assert_eq!(c.request_id(), None);
        assert_eq!(c.environment_id(), None);
        assert_eq!(c.cookie_jar_id(), None);
    }
}
