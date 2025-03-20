use crate::error::Result;
use crate::models::{Workspace, WorkspaceIden};
use crate::plugin::SqliteConnection;
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use sea_query::{Asterisk, Order, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use std::future::Future;
use std::ops::Deref;
use tauri::{AppHandle, Manager, Runtime};

pub struct QueryManager {
    pool: Pool<SqliteConnectionManager>,
}

pub trait DBConnection {
    fn connect(
        &self,
    ) -> impl Future<Output = Result<PooledConnection<SqliteConnectionManager>>> + Send;
}

impl<R: Runtime> DBConnection for AppHandle<R> {
    async fn connect(&self) -> Result<PooledConnection<SqliteConnectionManager>> {
        let dbm = &*self.state::<SqliteConnection>();
        let db = dbm.0.lock().await.get()?;
        Ok(db)
    }
}

pub async fn list_workspaces<T: Deref<Target = Connection>>(c: &T) -> Result<Vec<Workspace>> {
    let (sql, params) = Query::select()
        .from(WorkspaceIden::Table)
        .column(Asterisk)
        .order_by(WorkspaceIden::Name, Order::Asc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = c.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}
