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
//! that already builds pools changes. On wasm it is one connection that every
//! `get()` hands out a shared handle to.
//!
//! A `SqliteConn` only ever derefs immutably. The code above this layer opens
//! transactions with [`rusqlite::Transaction::new_unchecked`], which takes
//! `&Connection`; the `&mut` that `Connection::transaction` demands is a
//! compile-time guard against nesting a transaction on one connection, and it
//! is what would have forced the wasm pool to lend its connection exclusively.
//! The model layer nests connections freely — a helper that already holds one
//! calls another that asks for its own — so an exclusive lend would panic on
//! the second ask. Sharing the handle instead makes nested *reads* work the way
//! they do on the desktop; nested *write transactions* fail on both, only
//! differently (here SQLite refuses the inner `BEGIN`; natively the inner
//! connection blocks on `busy_timeout` and then fails).

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use r2d2_sqlite::SqliteConnectionManager;

    pub type SqlitePool = r2d2::Pool<SqliteConnectionManager>;
    pub type SqliteConn = r2d2::PooledConnection<SqliteConnectionManager>;
    pub type PoolError = r2d2::Error;
}

#[cfg(target_arch = "wasm32")]
mod imp {
    use rusqlite::Connection;
    use std::ops::Deref;
    use std::rc::Rc;

    /// One connection, shared by everyone who asks.
    ///
    /// `Rc` rather than `Arc` because a `Connection` is `!Sync`, so wrapping
    /// it in an `Arc` would buy no `Send`/`Sync` anyway — and there is one
    /// thread here to be honest about.
    #[derive(Clone, Debug)]
    pub struct SqlitePool {
        conn: Rc<Connection>,
    }

    impl SqlitePool {
        pub fn single(conn: Connection) -> Self {
            Self { conn: Rc::new(conn) }
        }

        /// Another handle to the connection. Cannot fail; the `Result` keeps
        /// the signature identical to r2d2's so callers are written once.
        pub fn get(&self) -> Result<SqliteConn, PoolError> {
            Ok(SqliteConn(self.conn.clone()))
        }
    }

    /// The error a `get()` would return if it could. It can't, so this has no
    /// variants; it exists so `Error::SqlPoolError` has the same shape on both
    /// targets.
    #[derive(Debug, thiserror::Error)]
    pub enum PoolError {}

    #[derive(Debug)]
    pub struct SqliteConn(Rc<Connection>);

    impl Deref for SqliteConn {
        type Target = Connection;
        fn deref(&self) -> &Connection {
            &self.0
        }
    }
}

pub use imp::*;
