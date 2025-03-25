use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{GrpcRequest, GrpcRequestIden};
use crate::queries_legacy::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_grpc_request(&self, id: &str) -> Result<Option<GrpcRequest>> {
        self.find_optional(GrpcRequestIden::Id, id)
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
        let request = self.get_grpc_request(id)?.unwrap();
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
}
