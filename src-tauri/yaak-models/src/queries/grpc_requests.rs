use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{GrpcRequest, GrpcRequestIden, HttpRequestHeader};
use crate::util::UpdateSource;
use serde_json::Value;
use std::collections::BTreeMap;

impl<'a> DbContext<'a> {
    pub fn get_grpc_request(&self, id: &str) -> Result<GrpcRequest> {
        self.find_one(GrpcRequestIden::Id, id)
    }

    pub fn list_grpc_requests(&self, workspace_id: &str) -> Result<Vec<GrpcRequest>> {
        self.find_many(GrpcRequestIden::WorkspaceId, workspace_id, None)
    }

    pub fn delete_grpc_request(
        &self,
        m: &GrpcRequest,
        source: &UpdateSource,
    ) -> Result<GrpcRequest> {
        self.delete_all_grpc_connections_for_request(m.id.as_str(), source)?;
        self.delete(m, source)
    }

    pub fn delete_grpc_request_by_id(
        &self,
        id: &str,
        source: &UpdateSource,
    ) -> Result<GrpcRequest> {
        let request = self.get_grpc_request(id)?;
        self.delete_grpc_request(&request, source)
    }

    pub fn duplicate_grpc_request(
        &self,
        grpc_request: &GrpcRequest,
        source: &UpdateSource,
    ) -> Result<GrpcRequest> {
        let mut request = grpc_request.clone();
        request.id = "".to_string();
        request.sort_priority = request.sort_priority + 0.001;
        self.upsert(&request, source)
    }

    pub fn upsert_grpc_request(
        &self,
        grpc_request: &GrpcRequest,
        source: &UpdateSource,
    ) -> Result<GrpcRequest> {
        self.upsert(grpc_request, source)
    }

    pub fn resolve_auth_for_grpc_request(
        &self,
        grpc_request: &GrpcRequest,
    ) -> Result<(Option<String>, BTreeMap<String, Value>)> {
        if let Some(at) = grpc_request.authentication_type.clone() {
            return Ok((Some(at), grpc_request.authentication.clone()));
        }

        if let Some(folder_id) = grpc_request.folder_id.clone() {
            let folder = self.get_folder(&folder_id)?;
            return self.resolve_auth_for_folder(folder);
        }

        let workspace = self.get_workspace(&grpc_request.workspace_id)?;
        Ok(self.resolve_auth_for_workspace(&workspace))
    }

    pub fn resolve_metadata_for_grpc_request(
        &self,
        grpc_request: &GrpcRequest,
    ) -> Result<Vec<HttpRequestHeader>> {
        // Resolved headers should be from furthest to closest ancestor, to override logically.
        let mut metadata = Vec::new();

        if let Some(folder_id) = grpc_request.folder_id.clone() {
            let parent_folder = self.get_folder(&folder_id)?;
            let mut folder_headers = self.resolve_headers_for_folder(&parent_folder)?;
            metadata.append(&mut folder_headers);
        } else {
            let workspace = self.get_workspace(&grpc_request.workspace_id)?;
            let mut workspace_metadata = self.resolve_headers_for_workspace(&workspace);
            metadata.append(&mut workspace_metadata);
        }

        metadata.append(&mut grpc_request.metadata.clone());

        Ok(metadata)
    }
}
