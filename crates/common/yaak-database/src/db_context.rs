use crate::connection_or_tx::ConnectionOrTx;
use crate::error::Error::ModelNotFound;
use crate::error::Result;
use crate::traits::UpsertModelInfo;
use crate::update_source::UpdateSource;
use sea_query::{
    Asterisk, Expr, Func, IntoColumnRef, IntoIden, OnConflict, Query, SimpleExpr,
    SqliteQueryBuilder,
};
use sea_query_rusqlite::RusqliteBinder;
use std::fmt::Debug;

pub struct DbContext<'a> {
    conn: ConnectionOrTx<'a>,
}

impl<'a> DbContext<'a> {
    pub fn new(conn: ConnectionOrTx<'a>) -> Self {
        Self { conn }
    }

    pub fn conn(&self) -> &ConnectionOrTx<'a> {
        &self.conn
    }

    pub fn find_one<M>(
        &self,
        col: impl IntoColumnRef + IntoIden + Clone,
        value: impl Into<SimpleExpr> + Debug,
    ) -> Result<M>
    where
        M: UpsertModelInfo,
    {
        let value_debug = format!("{:?}", value);
        let value_expr = value.into();
        let (sql, params) = Query::select()
            .from(M::table_name())
            .column(Asterisk)
            .cond_where(Expr::col(col.clone()).eq(value_expr))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str()).expect("Failed to prepare query");
        match stmt.query_row(&*params.as_params(), M::from_row) {
            Ok(result) => Ok(result),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(ModelNotFound(format!(
                r#"table "{}" {} == {}"#,
                M::table_name().into_iden().to_string(),
                col.into_iden().to_string(),
                value_debug
            ))),
            Err(e) => Err(crate::error::Error::SqlError(e)),
        }
    }

    pub fn find_optional<M>(
        &self,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Option<M>
    where
        M: UpsertModelInfo,
    {
        let (sql, params) = Query::select()
            .from(M::table_name())
            .column(Asterisk)
            .cond_where(Expr::col(col).eq(value))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str()).expect("Failed to prepare query");
        stmt.query_row(&*params.as_params(), M::from_row).ok()
    }

    pub fn find_all<M>(&self) -> Result<Vec<M>>
    where
        M: UpsertModelInfo,
    {
        let (order_by_col, order_by_dir) = M::order_by();
        let (sql, params) = Query::select()
            .from(M::table_name())
            .column(Asterisk)
            .order_by(order_by_col, order_by_dir)
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), M::from_row)?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    pub fn find_many<M>(
        &self,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
        limit: Option<u64>,
    ) -> Result<Vec<M>>
    where
        M: UpsertModelInfo,
    {
        let (order_by_col, order_by_dir) = M::order_by();
        let (sql, params) = if let Some(limit) = limit {
            Query::select()
                .from(M::table_name())
                .column(Asterisk)
                .cond_where(Expr::col(col).eq(value))
                .limit(limit)
                .order_by(order_by_col, order_by_dir)
                .build_rusqlite(SqliteQueryBuilder)
        } else {
            Query::select()
                .from(M::table_name())
                .column(Asterisk)
                .cond_where(Expr::col(col).eq(value))
                .order_by(order_by_col, order_by_dir)
                .build_rusqlite(SqliteQueryBuilder)
        };

        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), M::from_row)?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    /// Upsert a model. Returns `(model, created)` where `created` is true if a new row was inserted.
    pub fn upsert<M>(&self, model: &M, source: &UpdateSource) -> Result<(M, bool)>
    where
        M: UpsertModelInfo + Clone,
    {
        let id_iden = M::id_column().into_iden();
        let id_val = model.get_id();
        let other_values = model.clone().insert_values(source)?;

        let mut column_vec = vec![id_iden.clone()];
        let mut value_vec =
            vec![if id_val.is_empty() { M::generate_id().into() } else { id_val.into() }];

        for (col, val) in other_values {
            value_vec.push(val.into());
            column_vec.push(col.into_iden());
        }

        let on_conflict =
            OnConflict::column(id_iden).update_columns(M::update_columns()).to_owned();

        let (sql, params) = Query::insert()
            .into_table(M::table_name())
            .columns(column_vec)
            .values_panic(value_vec)
            .on_conflict(on_conflict)
            .returning(Query::returning().exprs(vec![
                Expr::col(Asterisk),
                Expr::expr(Func::cust("last_insert_rowid")),
                Expr::col("rowid"),
            ]))
            .build_rusqlite(SqliteQueryBuilder);

        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let (m, created): (M, bool) = stmt.query_row(&*params.as_params(), |row| {
            M::from_row(row).and_then(|m| {
                let rowid: i64 = row.get("rowid")?;
                let last_rowid: i64 = row.get("last_insert_rowid()")?;
                Ok((m, rowid == last_rowid))
            })
        })?;

        Ok((m, created))
    }

    /// Delete a model by its ID. Returns the number of rows deleted.
    pub fn delete<M>(&self, m: &M) -> Result<usize>
    where
        M: UpsertModelInfo,
    {
        let (sql, params) = Query::delete()
            .from_table(M::table_name())
            .cond_where(Expr::col(M::id_column().into_iden()).eq(m.get_id()))
            .build_rusqlite(SqliteQueryBuilder);
        let count = self.conn.execute(sql.as_str(), &*params.as_params())?;
        Ok(count)
    }
}
