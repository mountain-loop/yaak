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

    pub fn connect(&self) -> crate::error::Result<ClientDb<'_>> {
        let conn = self.pool.get()?;
        let ctx = DbContext::new(ConnectionOrTx::Connection(conn));
        Ok(ClientDb::new(ctx, self.events_tx.clone()))
    }

    pub fn with_tx<T, E>(
        &self,
        func: impl FnOnce(&ClientDb) -> std::result::Result<T, E>,
    ) -> std::result::Result<T, E>
    where
        E: From<crate::error::Error>,
    {
        let conn = self.pool.get().map_err(crate::error::Error::from)?;
        // `new_unchecked` takes `&Connection`; see yaak_database::pool for why
        // the pool never hands out `&mut`.
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
            .map_err(|e| GenericError(format!("Failed to start DB transaction: {e:?}")))?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;
    use crate::migrate::migrate_db;
    use crate::models::Workspace;
    use crate::util::UpdateSource;
    use r2d2_sqlite::SqliteConnectionManager;
    use std::time::Duration;

    /// A one-connection pool that gives up quickly, so exhaustion is reachable in a test
    /// without waiting out the app's acquire timeout.
    fn one_connection_pool(
        dir: &std::path::Path,
    ) -> (QueryManager, mpsc::Receiver<ModelPayload>) {
        let manager = SqliteConnectionManager::file(dir.join("db.sqlite"));
        let pool = r2d2::Pool::builder()
            .max_size(1)
            .connection_timeout(Duration::from_millis(100))
            .build(manager)
            .expect("build pool");
        migrate_db(&pool).expect("migrate");
        let (tx, rx) = mpsc::channel();
        (QueryManager::new(pool, tx), rx)
    }

    fn workspace(name: &str) -> Workspace {
        Workspace { name: name.to_string(), ..Default::default() }
    }

    #[test]
    fn exhausted_pool_reports_an_error_instead_of_panicking() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (qm, _events) = one_connection_pool(dir.path());

        let held = qm.connect().expect("first connection");

        match qm.connect() {
            Ok(_) => panic!("pool should be exhausted"),
            Err(e) => assert!(matches!(e, Error::SqlPoolError(_)), "got {e:?}"),
        }

        let err = qm
            .with_tx::<(), Error>(|db| {
                db.upsert_workspace(&workspace("never runs"), &UpdateSource::Background)?;
                Ok(())
            })
            .expect_err("pool is exhausted");
        assert!(matches!(err, Error::SqlPoolError(_)), "got {err:?}");

        drop(held);
        qm.connect().expect("pool recovers once the connection is back");
    }

    #[test]
    fn with_tx_returns_its_connection_on_every_exit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (qm, _events) = one_connection_pool(dir.path());

        qm.with_tx::<(), Error>(|db| {
            db.upsert_workspace(&workspace("committed"), &UpdateSource::Background)?;
            Ok(())
        })
        .expect("commit");

        let rolled_back = qm.with_tx::<(), Error>(|db| {
            db.upsert_workspace(&workspace("rolled back"), &UpdateSource::Background)?;
            Err(Error::Unknown)
        });
        assert!(rolled_back.is_err());

        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            qm.with_tx::<(), Error>(|db| {
                db.upsert_workspace(&workspace("panicked"), &UpdateSource::Background)?;
                panic!("closure blew up");
            })
        }));
        assert!(panicked.is_err());

        // The pool holds exactly one connection, so this only succeeds if all three
        // transactions above gave theirs back.
        let names = qm
            .connect()
            .expect("connection is back in the pool")
            .list_workspaces()
            .expect("list")
            .into_iter()
            .map(|w| w.name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["committed".to_string()]);
    }
}
