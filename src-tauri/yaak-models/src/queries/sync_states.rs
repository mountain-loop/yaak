use crate::error::Result;
use crate::models::{SyncState, SyncStateIden, UpsertModelInfo};
use crate::util::UpdateSource;
use sea_query::{Asterisk, Cond, Expr, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use std::path::Path;
use crate::db_context::DbContext;

impl<'a> DbContext<'a> {
    pub fn get_sync_state(&self, id: &str) -> Result<SyncState> {
        self.find_one(SyncStateIden::Id, id)
    }

    pub fn upsert_sync_state(&self, sync_state: &SyncState) -> Result<SyncState> {
        self.upsert(sync_state, &UpdateSource::Sync)
    }

    pub fn list_sync_states_for_workspace(
        &self,
        workspace_id: &str,
        sync_dir: &Path,
    ) -> Result<Vec<SyncState>> {
        let (sql, params) = Query::select()
            .from(SyncStateIden::Table)
            .column(Asterisk)
            .cond_where(
                Cond::all()
                    .add(Expr::col(SyncStateIden::WorkspaceId).eq(workspace_id))
                    .add(Expr::col(SyncStateIden::SyncDir).eq(sync_dir.to_string_lossy())),
            )
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), SyncState::from_row)?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    pub fn delete_sync_state(&self, sync_state: &SyncState) -> Result<SyncState> {
        self.delete(sync_state, &UpdateSource::Sync)
    }

    pub fn delete_sync_state_by_id(&self, id: &str) -> Result<SyncState> {
        let sync_state = self.get_sync_state(id)?;
        self.delete_sync_state(&sync_state)
    }
}
