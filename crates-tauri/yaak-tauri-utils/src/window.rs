use regex::Regex;
use tauri::{Runtime, WebviewWindow};

pub trait WorkspaceWindowTrait {
    fn workspace_id(&self) -> Option<String>;
    fn cookie_jar_id(&self) -> Option<String>;
    fn environment_id(&self) -> Option<String>;
    fn request_id(&self) -> Option<String>;
}

impl<R: Runtime> WorkspaceWindowTrait for WebviewWindow<R> {
    fn workspace_id(&self) -> Option<String> {
        let url = self.url().unwrap();
        let re = Regex::new(r"/workspaces/(?<id>\w+)").unwrap();
        match re.captures(url.as_str()) {
            None => None,
            Some(captures) => captures.name("id").map(|c| c.as_str().to_string()),
        }
    }

    fn cookie_jar_id(&self) -> Option<String> {
        let url = self.url().unwrap();
        let mut query_pairs = url.query_pairs();
        query_pairs.find(|(k, _v)| k == "cookie_jar_id").map(|(_k, v)| v.to_string())
    }

    fn environment_id(&self) -> Option<String> {
        let url = self.url().unwrap();
        let mut query_pairs = url.query_pairs();
        query_pairs.find(|(k, _v)| k == "environment_id").map(|(_k, v)| v.to_string())
    }

    fn request_id(&self) -> Option<String> {
        let url = self.url().unwrap();
        let mut query_pairs = url.query_pairs();
        query_pairs.find(|(k, _v)| k == "request_id").map(|(_k, v)| v.to_string())
    }
}
