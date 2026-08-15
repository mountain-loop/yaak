//! Where connections come from.
//!
//! Every query in the model layer asks a pool for a connection, uses it, and
//! hands it back. That is the whole contract, and it is the one place the
//! desktop and the browser genuinely differ: the desktop has threads and wants
//! an r2d2 pool; a browser tab has one thread, no way to spawn another, and one
//! connection is exactly enough. Everything above this module is identical on
//! both.
//!
//! On native targets `SqlitePool` *is* `r2d2::Pool` — a type alias, so nothing
//! that already builds pools changes. On wasm it is a single connection that is
//! checked out whole and put back on drop.

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use r2d2_sqlite::SqliteConnectionManager;

    pub type SqlitePool = r2d2::Pool<SqliteConnectionManager>;
    pub type SqliteConn = r2d2::PooledConnection<SqliteConnectionManager>;
}

#[cfg(target_arch = "wasm32")]
mod imp {
    use rusqlite::Connection;
    use std::ops::{Deref, DerefMut};
    use std::sync::{Arc, Mutex};

    /// One connection, lent out whole.
    ///
    /// `Arc<Mutex<..>>` rather than `Rc<RefCell<..>>` so the type is `Send +
    /// Sync` like its native counterpart, and so anything generic over the pool
    /// compiles the same way on both targets. There is no contention to speak
    /// of on one thread; the mutex is bookkeeping, not synchronization.
    #[derive(Clone, Debug)]
    pub struct SqlitePool {
        slot: Arc<Mutex<Option<Connection>>>,
    }

    impl SqlitePool {
        pub fn single(conn: Connection) -> Self {
            Self { slot: Arc::new(Mutex::new(Some(conn))) }
        }

        /// Check the connection out. Fails if it is already out — the
        /// equivalent of an exhausted pool, and on one thread it means a
        /// caller is holding a connection while asking for another, which the
        /// desktop would also stall on.
        pub fn get(&self) -> Result<SqliteConn, PoolError> {
            let conn = self.slot.lock().map_err(|_| PoolError::Poisoned)?.take();
            match conn {
                Some(conn) => Ok(SqliteConn { conn: Some(conn), home: self.slot.clone() }),
                None => Err(PoolError::Busy),
            }
        }
    }

    #[derive(Debug, thiserror::Error)]
    pub enum PoolError {
        #[error("the database connection is already in use")]
        Busy,
        #[error("the database connection slot was poisoned")]
        Poisoned,
    }

    /// The checked-out connection. Goes back into the pool when dropped.
    #[derive(Debug)]
    pub struct SqliteConn {
        conn: Option<Connection>,
        home: Arc<Mutex<Option<Connection>>>,
    }

    impl Deref for SqliteConn {
        type Target = Connection;
        fn deref(&self) -> &Connection {
            self.conn.as_ref().expect("connection present until drop")
        }
    }

    impl DerefMut for SqliteConn {
        fn deref_mut(&mut self) -> &mut Connection {
            self.conn.as_mut().expect("connection present until drop")
        }
    }

    impl Drop for SqliteConn {
        fn drop(&mut self) {
            if let (Some(conn), Ok(mut slot)) = (self.conn.take(), self.home.lock()) {
                *slot = Some(conn);
            }
        }
    }
}

pub use imp::*;

/// The error a pool hands back when it cannot lend a connection.
#[cfg(not(target_arch = "wasm32"))]
pub type PoolError = r2d2::Error;
