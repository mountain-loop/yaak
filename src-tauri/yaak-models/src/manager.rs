use crate::error::Result;
use crate::models::{Workspace, WorkspaceIden};
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, Transaction};
use sea_query::{Asterisk, Order, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct QueryManager {
    pool: Arc<Mutex<Pool<SqliteConnectionManager>>>,
}

impl QueryManager {
    pub(crate) fn new(pool: Pool<SqliteConnectionManager>) -> Self {
        QueryManager {
            pool: Arc::new(Mutex::new(pool)),
        }
    }

    pub fn connect(&self) -> Result<ConnectionOrTx> {
        let conn = self.pool.lock().unwrap().get()?;
        Ok(ConnectionOrTx::Connection(conn))
    }

    pub fn with_tx<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&ConnectionOrTx) -> Result<T>,
    {
        let mut conn = self.pool.lock().unwrap().get()?;
        let tx = conn.transaction()?;
        let c = ConnectionOrTx::Transaction(&tx);
        let result = f(&c);
        match result {
            Ok(val) => {
                tx.commit()?;
                Ok(val)
            }
            Err(err) => {
                // rollback is automatic on drop if commit hasn't been called,
                // but you can do it explicitly if you want
                tx.rollback()?;
                Err(err)
            }
        }
    }
}

pub enum ConnectionOrTx<'a> {
    Connection(PooledConnection<SqliteConnectionManager>),
    Transaction(&'a Transaction<'a>),
}

impl<'a> ConnectionOrTx<'a> {
    fn conn(&self) -> &Connection {
        match self {
            ConnectionOrTx::Connection(c) => c,
            ConnectionOrTx::Transaction(c) => c,
        }
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        let (sql, params) = Query::select()
            .from(WorkspaceIden::Table)
            .column(Asterisk)
            .order_by(WorkspaceIden::Name, Order::Asc)
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
        Ok(items.map(|v| v.unwrap()).collect())
    }
}
