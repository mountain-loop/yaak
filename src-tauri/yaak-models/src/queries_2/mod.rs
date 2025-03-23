use crate::error::Error::{ModelNotFound, RowNotFound};
use crate::error::Result;
use crate::manager::DbContext;
use crate::queries::{ModelChangeEvent, UpdateSource};
use rusqlite::{OptionalExtension, Row};
use sea_query::{
    Asterisk, Expr, IntoColumnRef, IntoIden, IntoTableRef, OnConflict, Query, SimpleExpr,
    SqliteQueryBuilder,
};
use sea_query_rusqlite::RusqliteBinder;
use serde::Serialize;
use std::fmt::Debug;

mod http_request;
mod http_responses;
mod workspace;

impl<'a> DbContext<'a> {
    pub fn find_one<'s, M>(
        &self,
        table: impl IntoTableRef,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Result<M>
    where
        M: for<'r> TryFrom<&'r Row<'r>, Error = rusqlite::Error>,
    {
        match self.find_optional::<M>(table, col, value) {
            Ok(Some(v)) => Ok(v),
            Ok(None) => Err(RowNotFound),
            Err(e) => Err(e),
        }
    }

    pub fn find_optional<'s, M>(
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

    pub fn find_all<'s, M, T>(&self, table: T) -> Result<Vec<M>>
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

    pub fn find_many<'s, M>(
        &self,
        table: impl IntoTableRef,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
        limit: Option<u64>,
    ) -> Result<Vec<M>>
    where
        M: for<'r> TryFrom<&'r Row<'r>, Error = rusqlite::Error>,
    {
        // TODO: Figure out how to do this conditional builder better
        let (sql, params) = if let Some(limit) = limit {
            Query::select()
                .from(table)
                .column(Asterisk)
                .cond_where(Expr::col(col).eq(value))
                .limit(limit)
                .build_rusqlite(SqliteQueryBuilder)
        } else {
            Query::select()
                .from(table)
                .column(Asterisk)
                .cond_where(Expr::col(col).eq(value))
                .build_rusqlite(SqliteQueryBuilder)
        };

        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    pub fn upsert_one<M>(
        &self,
        table: impl IntoTableRef,
        id_col: impl IntoIden + Eq + Clone,
        id_val: &str,
        gen_id: fn() -> String,
        other_values: Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>,
        update_columns: Vec<impl IntoIden>,
        update_source: &UpdateSource,
    ) -> Result<M>
    where
        M: for<'r> TryFrom<&'r Row<'r>, Error = rusqlite::Error> + Serialize + Debug + Clone,
    {
        let id_iden = id_col.into_iden();
        let mut column_vec = vec![id_iden.clone()];
        let mut value_vec = vec![if id_val == "" { gen_id().into() } else { id_val.into() }];

        for (col, val) in other_values {
            value_vec.push(val.into());
            column_vec.push(col.into_iden());
        }

        let on_conflict = OnConflict::column(id_iden).update_columns(update_columns).to_owned();
        let (sql, params) = Query::insert()
            .into_table(table)
            .columns(column_vec)
            .values_panic(value_vec)
            .on_conflict(on_conflict)
            .returning_all()
            .build_rusqlite(SqliteQueryBuilder);

        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let m: M = stmt.query_row(&*params.as_params(), |row| row.try_into())?;

        let payload = ModelChangeEvent::Upsert {
            model: serde_json::to_value(&m)?,
            update_source: update_source.clone(),
        };
        self.tx.send(payload).unwrap();

        Ok(m)
    }

    pub fn delete_one<'s, M>(
        &self,
        table: impl IntoTableRef + Clone,
        col: impl IntoColumnRef + Clone,
        value: &str,
        update_source: &UpdateSource,
    ) -> Result<M>
    where
        M: for<'r> TryFrom<&'r Row<'r>, Error = rusqlite::Error>,
    {
        let m = match self.find_optional(table.clone(), col.clone(), value)? {
            None => return Err(ModelNotFound(format!("{value}"))),
            Some(r) => r,
        };

        let (sql, params) = Query::delete()
            .from_table(table)
            .cond_where(Expr::col(col).eq(value))
            .build_rusqlite(SqliteQueryBuilder);
        self.conn.execute(sql.as_str(), &*params.as_params())?;

        let payload = ModelChangeEvent::Delete {
            id: value.to_string(),
            update_source: update_source.clone(),
        };

        self.tx.send(payload).unwrap();
        Ok(m)
    }
}
