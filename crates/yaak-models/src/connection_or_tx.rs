use r2d2::PooledConnection;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, Statement, ToSql, Transaction};

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
