use crate::error::Result;
use crate::models::{GrpcConnection, GrpcConnectionIden, GrpcConnectionState};
use crate::util::UpdateSource;
use log::debug;
use sea_query::{Expr, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use crate::db_context::DbContext;
use crate::queries::MAX_HISTORY_ITEMS;

impl<'a> DbContext<'a> {
    pub fn get_grpc_connection(&self, id: &str) -> Result<GrpcConnection> {
        self.find_one(GrpcConnectionIden::Id, id)
    }

    pub fn delete_all_grpc_connections_for_request(
        &self,
        request_id: &str,
        source: &UpdateSource,
    ) -> Result<()> {
        let responses = self.list_grpc_connections_for_request(request_id, None)?;
        for m in responses {
            self.delete(&m, source)?;
        }
        Ok(())
    }

    pub fn delete_all_grpc_connections_for_workspace(
        &self,
        workspace_id: &str,
        source: &UpdateSource,
    ) -> Result<()> {
        for m in self.list_grpc_connections_for_workspace(workspace_id, None)? {
            self.delete(&m, source)?;
        }
        Ok(())
    }

    pub fn delete_grpc_connection(
        &self,
        m: &GrpcConnection,
        source: &UpdateSource,
    ) -> Result<GrpcConnection> {
        self.delete(m, source)
    }

    pub fn delete_grpc_connection_by_id(
        &self,
        id: &str,
        source: &UpdateSource,
    ) -> Result<GrpcConnection> {
        let grpc_connection = self.get_grpc_connection(id)?;
        self.delete_grpc_connection(&grpc_connection, source)
    }

    pub fn list_grpc_connections_for_request(
        &self,
        request_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<GrpcConnection>> {
        self.find_many(GrpcConnectionIden::RequestId, request_id, limit)
    }

    pub fn list_grpc_connections_for_workspace(
        &self,
        workspace_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<GrpcConnection>> {
        self.find_many(GrpcConnectionIden::WorkspaceId, workspace_id, limit)
    }

    pub fn cancel_pending_grpc_connections(&self) -> Result<()> {
        let closed = serde_json::to_value(&GrpcConnectionState::Closed)?;
        let (sql, params) = Query::update()
            .table(GrpcConnectionIden::Table)
            .values([(GrpcConnectionIden::State, closed.as_str().into())])
            .cond_where(Expr::col(GrpcConnectionIden::State).ne(closed.as_str()))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str())?;
        stmt.execute(&*params.as_params())?;
        Ok(())
    }

    pub fn upsert_grpc_connection(
        &self,
        grpc_connection: &GrpcConnection,
        source: &UpdateSource,
    ) -> Result<GrpcConnection> {
        let connections =
            self.list_grpc_connections_for_request(grpc_connection.request_id.as_str(), None)?;

        for m in connections.iter().skip(MAX_HISTORY_ITEMS - 1) {
            debug!("Deleting old gRPC connection {}", grpc_connection.id);
            self.delete_grpc_connection(&m, source)?;
        }

        self.upsert(grpc_connection, source)
    }
}
