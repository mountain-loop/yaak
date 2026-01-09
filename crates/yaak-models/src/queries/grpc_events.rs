use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{GrpcEvent, GrpcEventIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_grpc_events(&self, id: &str) -> Result<GrpcEvent> {
        self.find_one(GrpcEventIden::Id, id)
    }

    pub fn list_grpc_events(&self, connection_id: &str) -> Result<Vec<GrpcEvent>> {
        self.find_many(GrpcEventIden::ConnectionId, connection_id, None)
    }

    pub fn upsert_grpc_event(
        &self,
        grpc_event: &GrpcEvent,
        source: &UpdateSource,
    ) -> Result<GrpcEvent> {
        self.upsert(grpc_event, source)
    }
}
