use super::{conflict_free_name, merge_headers};
use crate::client_db::ClientDb;
use crate::error::Result;
use crate::models::{
    AnyModel, Folder, FolderIden, HttpRequest, HttpRequestHeader, HttpRequestIden,
    ResolvedHttpRequestSettings, ResolvedSetting,
};
use crate::util::UpdateSource;
use serde_json::Value;
use std::collections::BTreeMap;

impl<'a> ClientDb<'a> {
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
        let sibling_names = self
            .list_http_requests(&http_request.workspace_id)?
            .into_iter()
            .filter(|m| m.folder_id == http_request.folder_id)
            .map(|m| m.name)
            .collect::<Vec<_>>();
        http_request.name = conflict_free_name(&http_request.name, &sibling_names);
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

        Ok(merge_headers(headers, http_request.headers.clone()))
    }

    pub fn resolve_settings_for_http_request(
        &self,
        http_request: &HttpRequest,
    ) -> Result<ResolvedHttpRequestSettings> {
        let parent = if let Some(folder_id) = http_request.folder_id.clone() {
            let folder = self.get_folder(&folder_id)?;
            self.resolve_settings_for_folder(&folder)?
        } else {
            let workspace = self.get_workspace(&http_request.workspace_id)?;
            self.resolve_settings_for_workspace(&workspace)
        };

        Ok(ResolvedHttpRequestSettings {
            validate_certificates: if http_request.setting_validate_certificates.enabled {
                ResolvedSetting::from_model(
                    http_request.setting_validate_certificates.value,
                    AnyModel::HttpRequest(http_request.clone()),
                )
            } else {
                parent.validate_certificates
            },
            follow_redirects: if http_request.setting_follow_redirects.enabled {
                ResolvedSetting::from_model(
                    http_request.setting_follow_redirects.value,
                    AnyModel::HttpRequest(http_request.clone()),
                )
            } else {
                parent.follow_redirects
            },
            request_timeout: if http_request.setting_request_timeout.enabled {
                ResolvedSetting::from_model(
                    http_request.setting_request_timeout.value,
                    AnyModel::HttpRequest(http_request.clone()),
                )
            } else {
                parent.request_timeout
            },
            request_message_size: parent.request_message_size,
            send_cookies: if http_request.setting_send_cookies.enabled {
                ResolvedSetting::from_model(
                    http_request.setting_send_cookies.value,
                    AnyModel::HttpRequest(http_request.clone()),
                )
            } else {
                parent.send_cookies
            },
            store_cookies: if http_request.setting_store_cookies.enabled {
                ResolvedSetting::from_model(
                    http_request.setting_store_cookies.value,
                    AnyModel::HttpRequest(http_request.clone()),
                )
            } else {
                parent.store_cookies
            },
            http_version: if http_request.setting_http_version.enabled {
                ResolvedSetting::from_model(
                    http_request.setting_http_version.value,
                    AnyModel::HttpRequest(http_request.clone()),
                )
            } else {
                parent.http_version
            },
        })
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
}

#[cfg(test)]
mod tests {
    use crate::init_in_memory;
    use crate::models::{
        Folder, HttpRequest, HttpRequestHeader, HttpVersion, InheritedHttpVersionSetting, Workspace,
    };
    use crate::util::UpdateSource;

    #[test]
    fn request_resolution_preserves_duplicate_request_headers() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let workspace = db.list_workspaces().expect("Failed to list workspaces").remove(0);
        let request = HttpRequest {
            workspace_id: workspace.id,
            headers: vec![
                HttpRequestHeader {
                    name: "Cookie".to_string(),
                    value: "required=1".to_string(),
                    ..Default::default()
                },
                HttpRequestHeader {
                    enabled: false,
                    name: "Cookie".to_string(),
                    value: "optional=1".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let resolved = db.resolve_headers_for_http_request(&request).expect("Failed to resolve");
        let cookies = resolved
            .iter()
            .filter(|header| header.name.eq_ignore_ascii_case("cookie"))
            .collect::<Vec<_>>();

        assert_eq!(cookies.len(), 2);
        assert_eq!(cookies[0].value, "required=1");
        assert_eq!(cookies[1].value, "optional=1");
        assert!(!cookies[1].enabled);
    }

    #[test]
    fn http_version_resolves_through_the_inheritance_chain() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();

        let workspace = db
            .upsert_workspace(
                &Workspace {
                    name: "Test".to_string(),
                    setting_http_version: HttpVersion::Http2,
                    ..Default::default()
                },
                &UpdateSource::Background,
            )
            .expect("Failed to upsert workspace");

        let folder = db
            .upsert_folder(
                &Folder { workspace_id: workspace.id.clone(), ..Default::default() },
                &UpdateSource::Background,
            )
            .expect("Failed to upsert folder");

        let request = db
            .upsert_http_request(
                &HttpRequest {
                    workspace_id: workspace.id.clone(),
                    folder_id: Some(folder.id.clone()),
                    ..Default::default()
                },
                &UpdateSource::Background,
            )
            .expect("Failed to upsert request");

        // No overrides, so the workspace base value applies
        let resolved = db.resolve_settings_for_http_request(&request).expect("Failed to resolve");
        assert_eq!(resolved.http_version.value, HttpVersion::Http2);
        assert_eq!(resolved.http_version.source_model, "workspace");

        // A folder override beats the workspace base
        db.upsert_folder(
            &Folder {
                setting_http_version: InheritedHttpVersionSetting {
                    enabled: true,
                    value: HttpVersion::Http1,
                },
                ..folder
            },
            &UpdateSource::Background,
        )
        .expect("Failed to update folder");
        let resolved = db.resolve_settings_for_http_request(&request).expect("Failed to resolve");
        assert_eq!(resolved.http_version.value, HttpVersion::Http1);
        assert_eq!(resolved.http_version.source_model, "folder");

        // A request override beats them both
        let request = db
            .upsert_http_request(
                &HttpRequest {
                    setting_http_version: InheritedHttpVersionSetting {
                        enabled: true,
                        value: HttpVersion::Auto,
                    },
                    ..request
                },
                &UpdateSource::Background,
            )
            .expect("Failed to update request");
        let resolved = db.resolve_settings_for_http_request(&request).expect("Failed to resolve");
        assert_eq!(resolved.http_version.value, HttpVersion::Auto);
        assert_eq!(resolved.http_version.source_model, "http_request");
    }
}
