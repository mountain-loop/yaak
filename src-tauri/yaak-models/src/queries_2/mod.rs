use crate::error::Error::RowNotFound;
use crate::error::Result;
use crate::manager::DbContext;
use rusqlite::{OptionalExtension, Row};
use sea_query::{
    Asterisk, Expr, IntoColumnRef, IntoTableRef, Query, SimpleExpr, SqliteQueryBuilder,
};
use sea_query_rusqlite::RusqliteBinder;

mod http_request;
mod workspace;

impl<'a> DbContext<'a> {
    pub fn get_where<'s, M>(
        &self,
        table: impl IntoTableRef,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Result<M>
    where
        M: for<'r> TryFrom<&'r Row<'r>, Error = rusqlite::Error>,
    {
        match self.get_where_optional::<M>(table, col, value) {
            Ok(Some(v)) => Ok(v),
            Ok(None) => Err(RowNotFound),
            Err(e) => Err(e),
        }
    }

    pub fn get_where_optional<'s, M>(
        &self,
        table: impl IntoTableRef,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Result<Option<M>>
    where
        M: for<'r> TryFrom<&'r Row<'r>, Error = rusqlite::Error>,
    {
        let (sql, params) = Query::select()
            .from(table)
            .column(Asterisk)
            .cond_where(Expr::col(col).eq(value))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str())?;
        Ok(stmt.query_row(&*params.as_params(), |row| row.try_into()).optional()?)
    }

    pub fn all<'s, M, T>(&self, table: T) -> Result<Vec<M>>
    where
        M: for<'r> TryFrom<&'r Row<'r>, Error = rusqlite::Error>,
        T: IntoTableRef,
    {
        let (sql, params) =
            Query::select().from(table).column(Asterisk).build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    pub fn list_where<'s, M>(
        &self,
        table: impl IntoTableRef,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Result<Vec<M>>
    where
        M: for<'r> TryFrom<&'r Row<'r>, Error = rusqlite::Error>,
    {
        let (sql, params) = Query::select()
            .from(table)
            .column(Asterisk)
            .cond_where(Expr::col(col).eq(value))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
        Ok(items.map(|v| v.unwrap()).collect())
    }
}
