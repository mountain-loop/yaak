use crate::pool::SqliteConn;
use rusqlite::{Connection, Statement, ToSql, Transaction};

pub enum ConnectionOrTx<'a> {
    Connection(SqliteConn),
    Transaction(&'a Transaction<'a>),
}

impl<'a> ConnectionOrTx<'a> {
    pub fn resolve(&self) -> &Connection {
        match self {
            ConnectionOrTx::Connection(c) => c,
            ConnectionOrTx::Transaction(c) => c,
        }
    }

    pub fn prepare(&self, sql: &str) -> rusqlite::Result<Statement<'_>> {
        self.resolve().prepare(sql)
    }

    pub fn execute(&self, sql: &str, params: &[&dyn ToSql]) -> rusqlite::Result<usize> {
        self.resolve().execute(sql, params)
    }
}
