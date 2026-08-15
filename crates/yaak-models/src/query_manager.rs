use crate::client_db::ClientDb;
use crate::error::Error::GenericError;
use crate::util::ModelPayload;
use rusqlite::{Transaction, TransactionBehavior};
use std::sync::mpsc;
use yaak_database::{ConnectionOrTx, DbContext, SqlitePool};

// Pool is internally synchronized — don't wrap it in a Mutex. A Mutex held across the
// blocking `get()` serializes every DB access behind the slowest waiter, freezing the
// whole app whenever the pool is exhausted.
#[derive(Debug, Clone)]
pub struct QueryManager {
    pool: SqlitePool,
    events_tx: mpsc::Sender<ModelPayload>,
}

impl QueryManager {
    pub fn new(pool: SqlitePool, events_tx: mpsc::Sender<ModelPayload>) -> Self {
        QueryManager { pool, events_tx }
    }

    pub fn connect(&self) -> ClientDb<'_> {
        let conn = self.pool.get().expect("Failed to get a new DB connection from the pool");
        let ctx = DbContext::new(ConnectionOrTx::Connection(conn));
        ClientDb::new(ctx, self.events_tx.clone())
    }

    pub fn with_conn<F, T>(&self, func: F) -> T
    where
        F: FnOnce(&ClientDb) -> T,
    {
        let conn = self.pool.get().expect("Failed to get new DB connection from the pool");

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
        let conn = self.pool.get().expect("Failed to get new DB connection from the pool");
        // `new_unchecked` takes `&Connection`; see yaak_database::pool for why
        // the pool never hands out `&mut`.
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
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
