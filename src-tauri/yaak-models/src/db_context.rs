use crate::connection_or_tx::ConnectionOrTx;
use crate::error::Error::ModelNotFound;
use crate::error::Result;
use crate::models::{AnyModel, UpsertModelInfo};
use crate::util::{ModelChangeEvent, ModelPayload, UpdateSource};
use log::error;
use rusqlite::OptionalExtension;
use sea_query::{
    Asterisk, Expr, IntoColumnRef, IntoIden, IntoTableRef, OnConflict, Query, SimpleExpr,
    SqliteQueryBuilder,
};
use sea_query_rusqlite::RusqliteBinder;
use std::fmt::Debug;
use std::sync::mpsc;

pub struct DbContext<'a> {
    pub(crate) events_tx: mpsc::Sender<ModelPayload>,
    pub(crate) conn: ConnectionOrTx<'a>,
}

impl<'a> DbContext<'a> {
    pub(crate) fn find_one<'s, M>(
        &self,
        col: impl IntoColumnRef + IntoIden + Clone,
        value: impl Into<SimpleExpr> + Debug,
    ) -> Result<M>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
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
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err(ModelNotFound(format!(
                    r#"table "{}" {} == {}"#,
                    M::table_name().into_iden().to_string(),
                    col.into_iden().to_string(),
                    value_debug
                )))
            }
            Err(e) => Err(crate::error::Error::SqlError(e)),
        }
    }

    pub(crate) fn find_optional<'s, M>(
        &self,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Option<M>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
    {
        let (sql, params) = Query::select()
            .from(M::table_name())
            .column(Asterisk)
            .cond_where(Expr::col(col).eq(value))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str()).expect("Failed to prepare query");
        stmt.query_row(&*params.as_params(), M::from_row)
            .optional()
            .expect("Failed to run find on DB")
    }

    pub fn find_all<'s, M>(&self) -> crate::error::Result<Vec<M>>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
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

    pub fn find_many<'s, M>(
        &self,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
        limit: Option<u64>,
    ) -> Result<Vec<M>>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
    {
        // TODO: Figure out how to do this conditional builder better
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

    pub fn upsert<M>(&self, model: &M, source: &UpdateSource) -> crate::error::Result<M>
    where
        M: Into<AnyModel> + From<AnyModel> + UpsertModelInfo + Clone,
    {
        self.upsert_one(
            M::table_name(),
            M::id_column(),
            model.get_id().as_str(),
            model.clone().insert_values(source)?,
            M::update_columns(),
            source,
        )
    }

    fn upsert_one<M>(
        &self,
        table: impl IntoTableRef,
        id_col: impl IntoIden + Eq + Clone,
        id_val: &str,
        other_values: Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>,
        update_columns: Vec<impl IntoIden>,
        source: &UpdateSource,
    ) -> crate::error::Result<M>
    where
        M: Into<AnyModel> + From<AnyModel> + UpsertModelInfo + Clone,
    {
        let id_iden = id_col.into_iden();
        let mut column_vec = vec![id_iden.clone()];
        let mut value_vec =
            vec![if id_val == "" { M::generate_id().into() } else { id_val.into() }];

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
        let m: M = stmt.query_row(&*params.as_params(), |row| M::from_row(row))?;

        let payload = ModelPayload {
            model: m.clone().into(),
            update_source: source.clone(),
            change: ModelChangeEvent::Upsert,
        };

        if let Err(e) = self.events_tx.send(payload.clone()) {
            error!("Failed to send model change {source:?}: {e:?}");
        }

        Ok(m)
    }

    pub(crate) fn delete<'s, M>(&self, m: &M, source: &UpdateSource) -> crate::error::Result<M>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
    {
        let (sql, params) = Query::delete()
            .from_table(M::table_name())
            .cond_where(Expr::col(M::id_column().into_iden()).eq(m.get_id()))
            .build_rusqlite(SqliteQueryBuilder);
        self.conn.execute(sql.as_str(), &*params.as_params())?;

        let payload = ModelPayload {
            model: m.clone().into(),
            update_source: source.clone(),
            change: ModelChangeEvent::Delete,
        };

        if let Err(e) = self.events_tx.send(payload) {
            error!("Failed to send model change {source:?}: {e:?}");
        }
        Ok(m.clone())
    }
}
