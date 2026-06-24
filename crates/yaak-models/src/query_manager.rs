use crate::client_db::ClientDb;
use crate::error::Error::GenericError;
use crate::util::ModelPayload;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::TransactionBehavior;
use std::sync::{Arc, Mutex, mpsc};
use yaak_database::{ConnectionOrTx, DbContext};

#[derive(Debug, Clone)]
pub struct QueryManager {
    pool: Arc<Mutex<Pool<SqliteConnectionManager>>>,
    events_tx: mpsc::Sender<ModelPayload>,
}

impl QueryManager {
    pub fn new(pool: Pool<SqliteConnectionManager>, events_tx: mpsc::Sender<ModelPayload>) -> Self {
        QueryManager { pool: Arc::new(Mutex::new(pool)), events_tx }
    }

    pub fn connect(&self) -> ClientDb<'_> {
        let conn = self
            .pool
            .lock()
            .expect("Failed to gain lock on DB")
            .get()
            .expect("Failed to get a new DB connection from the pool");
        let ctx = DbContext::new(ConnectionOrTx::Connection(conn));
        ClientDb::new(ctx, self.events_tx.clone())
    }

    pub fn with_conn<F, T>(&self, func: F) -> T
    where
        F: FnOnce(&ClientDb) -> T,
    {
        let conn = self
            .pool
            .lock()
            .expect("Failed to gain lock on DB for transaction")
            .get()
            .expect("Failed to get new DB connection from the pool");

        let ctx = DbContext::new(ConnectionOrTx::Connection(conn));
        let db = ClientDb::new(ctx, self.events_tx.clone());

        func(&db)
    }

    pub fn with_tx<T, E>(
        &self,
        func: impl FnOnce(&ClientDb) -> std::result::Result<T, E>,
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

        let ctx = DbContext::new(ConnectionOrTx::Transaction(&tx));
        let db = ClientDb::new(ctx, self.events_tx.clone());

        match func(&db) {
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
