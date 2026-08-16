use regex::Regex;
use tauri::{Runtime, Url, WebviewWindow};
use yaak_core::WorkspaceContext;

pub trait WorkspaceWindowTrait {
    fn workspace_id(&self) -> Option<String>;
    fn cookie_jar_id(&self) -> Option<String>;
    fn environment_id(&self) -> Option<String>;
    fn request_id(&self) -> Option<String>;
    /// All four at once, from a single read of the window URL.
    fn workspace_context(&self) -> WorkspaceContext;
}

impl<R: Runtime> WorkspaceWindowTrait for WebviewWindow<R> {
    fn workspace_id(&self) -> Option<String> {
        workspace_id_from_url(&self.url().unwrap())
    }

    fn cookie_jar_id(&self) -> Option<String> {
        query_param(&self.url().unwrap(), "cookie_jar_id")
    }

    fn environment_id(&self) -> Option<String> {
        query_param(&self.url().unwrap(), "environment_id")
    }

    fn request_id(&self) -> Option<String> {
        query_param(&self.url().unwrap(), "request_id")
    }

    fn workspace_context(&self) -> WorkspaceContext {
        let url = self.url().unwrap();
        WorkspaceContext {
            workspace_id: workspace_id_from_url(&url),
            environment_id: query_param(&url, "environment_id"),
            cookie_jar_id: query_param(&url, "cookie_jar_id"),
            request_id: query_param(&url, "request_id"),
        }
    }
}

fn workspace_id_from_url(url: &Url) -> Option<String> {
    let re = Regex::new(r"/workspaces/(?<id>\w+)").unwrap();
    match re.captures(url.as_str()) {
        None => None,
        Some(captures) => captures.name("id").map(|c| c.as_str().to_string()),
    }
}

fn query_param(url: &Url, key: &str) -> Option<String> {
    let mut query_pairs = url.query_pairs();
    query_pairs.find(|(k, _v)| k == key).map(|(_k, v)| v.to_string())
}
