use crate::connection_or_tx::ConnectionOrTx;
use crate::db_context::DbContext;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::util::ModelPayload;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::TransactionBehavior;
use std::sync::{mpsc, Arc, Mutex};
use tauri::{Manager, Runtime, State};

pub trait QueryManagerExt<'a, R> {
    fn db_manager(&'a self) -> State<'a, QueryManager>;
    fn db(&'a self) -> DbContext<'a>;
    fn with_db<F, T>(&'a self, func: F) -> T
    where
        F: FnOnce(&DbContext) -> T;
    fn with_tx<F, T>(&'a self, func: F) -> Result<T>
    where
        F: FnOnce(&DbContext) -> Result<T>;
}

impl<'a, R: Runtime, M: Manager<R>> QueryManagerExt<'a, R> for M {
    fn db_manager(&'a self) -> State<'a, QueryManager> {
        self.state::<QueryManager>()
    }

    fn db(&'a self) -> DbContext<'a> {
        let qm = self.state::<QueryManager>();
        qm.inner().connect()
    }

    fn with_db<F, T>(&'a self, func: F) -> T
    where
        F: FnOnce(&DbContext) -> T,
    {
        let qm = self.state::<QueryManager>();
        qm.inner().with_conn(func)
    }

    fn with_tx<F, T>(&'a self, func: F) -> Result<T>
    where
        F: FnOnce(&DbContext) -> Result<T>,
    {
        let qm = self.state::<QueryManager>();
        qm.inner().with_tx(func)
    }
}

#[derive(Debug, Clone)]
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

    pub fn connect(&self) -> DbContext<'_> {
        let conn = self
            .pool
            .lock()
            .expect("Failed to gain lock on DB")
            .get()
            .expect("Failed to get a new DB connection from the pool");
        DbContext {
            events_tx: self.events_tx.clone(),
            conn: ConnectionOrTx::Connection(conn),
        }
    }

    pub fn with_conn<F, T>(&self, func: F) -> T
    where
        F: FnOnce(&DbContext) -> T,
    {
        let conn = self
            .pool
            .lock()
            .expect("Failed to gain lock on DB for transaction")
            .get()
            .expect("Failed to get new DB connection from the pool");

        let db_context = DbContext {
            events_tx: self.events_tx.clone(),
            conn: ConnectionOrTx::Connection(conn),
        };

        func(&db_context)
    }

    pub fn with_tx<T, E>(
        &self,
        func: impl FnOnce(&DbContext) -> std::result::Result<T, E>,
    ) -> std::result::Result<T, E>
    where
        E: From<crate::error::Error>,
    {
        let mut conn = self
            .pool
            .lock()
            .expect("Failed to gain lock on DB for transaction")
            .get()
            .expect("Failed to get new DB connection from the pool");
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("Failed to start DB transaction");

        let db_context = DbContext {
            events_tx: self.events_tx.clone(),
            conn: ConnectionOrTx::Transaction(&tx),
        };

        match func(&db_context) {
            Ok(val) => {
                tx.commit()
                    .map_err(|e| GenericError(format!("Failed to commit transaction {e:?}")))?;
                Ok(val)
            }
            Err(e) => {
                tx.rollback()
                    .map_err(|e| GenericError(format!("Failed to rollback transaction {e:?}")))?;
                Err(e)
            }
        }
    }
}
