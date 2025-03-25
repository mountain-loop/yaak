use crate::error::Result;
use crate::queries_legacy::ModelPayload;
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, Statement, ToSql, Transaction, TransactionBehavior};
use std::sync::Arc;
use tauri::{Manager, Runtime};
use tokio::sync::{mpsc, Mutex};

pub trait QueryManagerExt<'a, R> {
    fn queries(&'a self) -> &'a QueryManager;
}

impl<'a, R: Runtime, T: Manager<R>> QueryManagerExt<'a, R> for T {
    fn queries(&'a self) -> &'a QueryManager {
        let qm = self.state::<QueryManager>();
        qm.inner()
    }
}

#[derive(Clone)]
pub struct QueryManager {
    pool: Arc<Mutex<Pool<SqliteConnectionManager>>>,
    events_tx: mpsc::Sender<ModelPayload>,
}

impl QueryManager {
    pub(crate) fn new(
        pool: Pool<SqliteConnectionManager>,
        events_tx: mpsc::Sender<ModelPayload>,
    ) -> Self {
        QueryManager {
            pool: Arc::new(Mutex::new(pool)),
            events_tx,
        }
    }

    pub async fn connect(&self) -> Result<DbContext> {
        let conn = self.pool.lock().await.get()?;
        Ok(DbContext {
            tx: self.events_tx.clone(),
            conn: ConnectionOrTx::Connection(conn),
        })
    }

    pub async fn with_conn<F, T>(&self, func: F) -> Result<T>
    where
        F: FnOnce(&DbContext) -> Result<T>,
    {
        let conn = self.pool.lock().await.get()?;
        let db_context = DbContext {
            tx: self.events_tx.clone(),
            conn: ConnectionOrTx::Connection(conn),
        };
        func(&db_context)
    }

    pub async fn with_tx<F, T>(&self, func: F) -> Result<T>
    where
        F: FnOnce(&DbContext) -> Result<T>,
    {
        let mut conn = self.pool.lock().await.get()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let db_context = DbContext {
            tx: self.events_tx.clone(),
            conn: ConnectionOrTx::Transaction(&tx),
        };

        match func(&db_context) {
            Ok(val) => {
                tx.commit()?;
                Ok(val)
            }
            Err(e) => {
                tx.rollback()?;
                Err(e)
            }
        }
    }
}

pub enum ConnectionOrTx<'a> {
    Connection(PooledConnection<SqliteConnectionManager>),
    Transaction(&'a Transaction<'a>),
}

impl<'a> ConnectionOrTx<'a> {
    pub(crate) fn resolve(&self) -> &Connection {
        match self {
            ConnectionOrTx::Connection(c) => c,
            ConnectionOrTx::Transaction(c) => c,
        }
    }

    pub(crate) fn prepare(&self, sql: &str) -> rusqlite::Result<Statement<'_>> {
        self.resolve().prepare(sql)
    }

    pub(crate) fn execute(&self, sql: &str, params: &[&dyn ToSql]) -> rusqlite::Result<usize> {
        self.resolve().execute(sql, params)
    }
}

pub struct DbContext<'a> {
    pub(crate) tx: mpsc::Sender<ModelPayload>,
    pub(crate) conn: ConnectionOrTx<'a>,
}
