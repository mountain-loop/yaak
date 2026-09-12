use crate::client_db::{ClientDb, WriteDb};
use crate::error::Error::GenericError;
use crate::util::ModelPayload;
use rusqlite::{Transaction, TransactionBehavior};
use std::sync::mpsc;
use yaak_database::{ConnectionOrTx, DbContext, SqlitePool};

/// Reads come from a pool; writes go through one connection.
///
/// SQLite in WAL mode lets many readers run alongside a single writer, and
/// never more than one writer. A second in-process writer can only wait, and
/// while it waits in the busy handler it sleeps, retries, and keeps its pool
/// slot. Enough of those and the pool is full of writers that are all asleep,
/// and every read in the app queues behind them. Giving writes exactly one
/// connection turns that into a plain queue: the next write starts the moment
/// the previous one commits, and it never takes a slot a read could use.
///
/// The pools are internally synchronized — don't wrap them in a Mutex. A Mutex
/// held across the blocking `get()` serializes every DB access behind the
/// slowest waiter.
#[derive(Debug, Clone)]
pub struct QueryManager {
    readers: SqlitePool,
    writer: SqlitePool,
    events_tx: mpsc::Sender<ModelPayload>,
}

impl QueryManager {
    /// `writer` must be a pool with a single connection; see [`crate::init_standalone`].
    pub fn new(
        readers: SqlitePool,
        writer: SqlitePool,
        events_tx: mpsc::Sender<ModelPayload>,
    ) -> Self {
        QueryManager { readers, writer, events_tx }
    }

    /// A read handle from the reader pool.
    pub fn connect(&self) -> ClientDb<'_> {
        let conn = self.readers.get().expect("Failed to get a new DB connection from the pool");
        ClientDb::new(DbContext::new(ConnectionOrTx::Connection(conn)))
    }

    /// Run `func` in a transaction on the writer connection.
    ///
    /// Waits for any write in progress to commit first, and fails with a pool
    /// error if that takes longer than the pool's timeout. Do not call this
    /// from inside another `with_tx` closure: the inner call would wait for
    /// the outer transaction, which is waiting on it.
    ///
    /// Model events for the writes are sent once the transaction commits.
    pub fn with_tx<T, E>(
        &self,
        func: impl FnOnce(&WriteDb) -> std::result::Result<T, E>,
    ) -> std::result::Result<T, E>
    where
        E: From<crate::error::Error>,
    {
        let conn = self.writer.get().map_err(crate::error::Error::SqlPoolError)?;
        // `new_unchecked` takes `&Connection`; see yaak_database::pool for why
        // the pool never hands out `&mut`.
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
            .map_err(crate::error::Error::SqlError)?;

        let db =
            WriteDb::new(DbContext::new(ConnectionOrTx::Transaction(&tx)), self.events_tx.clone());

        match func(&db) {
            Ok(val) => {
                let events = db.into_events();
                tx.commit()
                    .map_err(|e| GenericError(format!("Failed to commit transaction {e:?}")))?;
                for payload in events {
                    let _ = self.events_tx.send(payload);
                }
                Ok(val)
            }
            Err(e) => {
                drop(db);
                tx.rollback()
                    .map_err(|e| GenericError(format!("Failed to rollback transaction {e:?}")))?;
                Err(e)
            }
        }
    }
}
