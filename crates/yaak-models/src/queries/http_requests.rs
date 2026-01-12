use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{Folder, FolderIden, HttpRequest, HttpRequestHeader, HttpRequestIden, ResolvedHttpRequestSettings};
use crate::util::UpdateSource;
use serde_json::Value;
use std::collections::BTreeMap;

impl<'a> DbContext<'a> {
    pub fn get_http_request(&self, id: &str) -> Result<HttpRequest> {
        self.find_one(HttpRequestIden::Id, id)
    }

    pub fn list_http_requests(&self, workspace_id: &str) -> Result<Vec<HttpRequest>> {
        self.find_many(HttpRequestIden::WorkspaceId, workspace_id, None)
    }

    pub fn delete_http_request(
        &self,
        m: &HttpRequest,
        source: &UpdateSource,
    ) -> Result<HttpRequest> {
        self.delete_all_http_responses_for_request(m.id.as_str(), source)?;
        self.delete(m, source)
    }

    pub fn delete_http_request_by_id(
        &self,
        id: &str,
        source: &UpdateSource,
    ) -> Result<HttpRequest> {
        let http_request = self.get_http_request(id)?;
        self.delete_http_request(&http_request, source)
    }

    pub fn duplicate_http_request(
        &self,
        http_request: &HttpRequest,
        source: &UpdateSource,
    ) -> Result<HttpRequest> {
        let mut http_request = http_request.clone();
        http_request.id = "".to_string();
        http_request.sort_priority = http_request.sort_priority + 0.001;
        self.upsert(&http_request, source)
    }

    pub fn upsert_http_request(
        &self,
        http_request: &HttpRequest,
        source: &UpdateSource,
    ) -> Result<HttpRequest> {
        self.upsert(http_request, source)
    }

    pub fn resolve_auth_for_http_request(
        &self,
        http_request: &HttpRequest,
    ) -> Result<(Option<String>, BTreeMap<String, Value>, String)> {
        if let Some(at) = http_request.authentication_type.clone() {
            return Ok((Some(at), http_request.authentication.clone(), http_request.id.clone()));
        }

        if let Some(folder_id) = http_request.folder_id.clone() {
            let folder = self.get_folder(&folder_id)?;
            return self.resolve_auth_for_folder(&folder);
        }

        let workspace = self.get_workspace(&http_request.workspace_id)?;
        Ok(self.resolve_auth_for_workspace(&workspace))
    }

    pub fn resolve_headers_for_http_request(
        &self,
        http_request: &HttpRequest,
    ) -> Result<Vec<HttpRequestHeader>> {
        // Resolved headers should be from furthest to closest ancestor, to override logically.
        let mut headers = Vec::new();

        if let Some(folder_id) = http_request.folder_id.clone() {
            let parent_folder = self.get_folder(&folder_id)?;
            let mut folder_headers = self.resolve_headers_for_folder(&parent_folder)?;
            headers.append(&mut folder_headers);
        } else {
            let workspace = self.get_workspace(&http_request.workspace_id)?;
            let mut workspace_headers = self.resolve_headers_for_workspace(&workspace);
            headers.append(&mut workspace_headers);
        }

        headers.append(&mut http_request.headers.clone());

        Ok(headers)
    }

    pub fn list_http_requests_for_folder_recursive(
        &self,
        folder_id: &str,
    ) -> Result<Vec<HttpRequest>> {
        let mut children = Vec::new();
        for m in self.find_many::<Folder>(FolderIden::FolderId, folder_id, None)? {
            children.extend(self.list_http_requests_for_folder_recursive(&m.id)?);
        }
        for m in self.find_many::<HttpRequest>(FolderIden::FolderId, folder_id, None)? {
            children.push(m);
        }
        Ok(children)
    }

    /// Resolve settings for an HTTP request by walking the inheritance chain:
    /// Workspace → Folder(s) → Request
    /// Last non-None value wins, then defaults are applied.
    pub fn resolve_settings_for_http_request(
        &self,
        http_request: &HttpRequest,
    ) -> Result<ResolvedHttpRequestSettings> {
        let workspace = self.get_workspace(&http_request.workspace_id)?;

        // Start with None for all settings
        let mut validate_certs: Option<bool> = None;
        let mut follow_redirects: Option<bool> = None;
        let mut timeout: Option<i32> = None;

        // Apply workspace settings
        if workspace.setting_validate_certificates.is_some() {
            validate_certs = workspace.setting_validate_certificates;
        }
        if workspace.setting_follow_redirects.is_some() {
            follow_redirects = workspace.setting_follow_redirects;
        }
        if workspace.setting_request_timeout.is_some() {
            timeout = workspace.setting_request_timeout;
        }

        // Apply folder chain settings (root first, immediate parent last)
        if let Some(folder_id) = &http_request.folder_id {
            let folders = self.get_folder_ancestors(folder_id)?;
            for folder in folders {
                if folder.setting_validate_certificates.is_some() {
                    validate_certs = folder.setting_validate_certificates;
                }
                if folder.setting_follow_redirects.is_some() {
                    follow_redirects = folder.setting_follow_redirects;
                }
                if folder.setting_request_timeout.is_some() {
                    timeout = folder.setting_request_timeout;
                }
            }
        }

        // Apply request-level settings (highest priority)
        if http_request.setting_validate_certificates.is_some() {
            validate_certs = http_request.setting_validate_certificates;
        }
        if http_request.setting_follow_redirects.is_some() {
            follow_redirects = http_request.setting_follow_redirects;
        }
        if http_request.setting_request_timeout.is_some() {
            timeout = http_request.setting_request_timeout;
        }

        // Apply defaults for anything still None
        Ok(ResolvedHttpRequestSettings {
            validate_certificates: validate_certs.unwrap_or(true),
            follow_redirects: follow_redirects.unwrap_or(true),
            request_timeout: timeout.unwrap_or(0),
        })
    }

    /// Get folder ancestors in order from root to immediate parent
    fn get_folder_ancestors(&self, folder_id: &str) -> Result<Vec<Folder>> {
        let mut ancestors = Vec::new();
        let mut current_id = Some(folder_id.to_string());

        while let Some(id) = current_id {
            let folder = self.get_folder(&id)?;
            current_id = folder.folder_id.clone();
            ancestors.push(folder);
        }

        ancestors.reverse(); // Root first, immediate parent last
        Ok(ancestors)
    }
}
