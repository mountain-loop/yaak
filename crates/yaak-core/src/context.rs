use std::path::PathBuf;

/// Context for a workspace operation.
///
/// In Tauri, this is extracted from the WebviewWindow URL.
/// In CLI, this is constructed from command arguments or config.
#[derive(Debug, Clone, Default)]
pub struct WorkspaceContext {
    pub workspace_id: Option<String>,
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
    pub request_id: Option<String>,
}

impl WorkspaceContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_workspace(mut self, workspace_id: impl Into<String>) -> Self {
        self.workspace_id = Some(workspace_id.into());
        self
    }

    pub fn with_environment(mut self, environment_id: impl Into<String>) -> Self {
        self.environment_id = Some(environment_id.into());
        self
    }

    pub fn with_cookie_jar(mut self, cookie_jar_id: impl Into<String>) -> Self {
        self.cookie_jar_id = Some(cookie_jar_id.into());
        self
    }

    pub fn with_request(mut self, request_id: impl Into<String>) -> Self {
        self.request_id = Some(request_id.into());
        self
    }
}

/// Application context trait for accessing app-level resources.
///
/// This abstracts over Tauri's `AppHandle` for path resolution and app identity.
/// Implemented by Tauri's AppHandle and by CLI's own context struct.
pub trait AppContext: Send + Sync + Clone {
    /// Returns the path to the application data directory.
    /// This is where the database and other persistent data are stored.
    fn app_data_dir(&self) -> PathBuf;

    /// Returns the application identifier (e.g., "app.yaak.desktop").
    /// Used for keyring access and other platform-specific features.
    fn app_identifier(&self) -> &str;

    /// Returns true if running in development mode.
    fn is_dev(&self) -> bool;
}
