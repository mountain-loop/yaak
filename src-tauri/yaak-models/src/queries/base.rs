use crate::error::Error::RowNotFound;
use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{AnyModel, ModelType, UpsertModelInfo};
use crate::queries_legacy::{generate_model_id, ModelChangeEvent, ModelPayload, UpdateSource};
use rusqlite::OptionalExtension;
use sea_query::{
    Asterisk, Expr, IntoColumnRef, IntoIden, IntoTableRef, OnConflict, Query, SimpleExpr,
    SqliteQueryBuilder,
};
use sea_query_rusqlite::RusqliteBinder;

pub(crate) const MAX_HISTORY_ITEMS: usize = 20;

impl<'a> DbContext<'a> {
    pub(crate) fn find_one<'s, M>(
        &self,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Result<M>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
    {
        match self.find_optional::<M>(col, value) {
            Ok(Some(v)) => Ok(v),
            Ok(None) => Err(RowNotFound),
            Err(e) => Err(e),
        }
    }

    pub fn find_optional<'s, M>(
        &self,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Result<Option<M>>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
    {
        let (sql, params) = Query::select()
            .from(M::table_name())
            .column(Asterisk)
            .cond_where(Expr::col(col).eq(value))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str())?;
        Ok(stmt.query_row(&*params.as_params(), M::from_row).optional()?)
    }

    pub fn find_all<'s, M>(&self) -> Result<Vec<M>>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
    {
        let (sql, params) = Query::select()
            .from(M::table_name())
            .column(Asterisk)
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
        let (sql, params) = if let Some(limit) = limit {
            Query::select()
                .from(M::table_name())
                .column(Asterisk)
                .cond_where(Expr::col(col).eq(value))
                .limit(limit)
                .build_rusqlite(SqliteQueryBuilder)
        } else {
            Query::select()
                .from(M::table_name())
                .column(Asterisk)
                .cond_where(Expr::col(col).eq(value))
                .build_rusqlite(SqliteQueryBuilder)
        };

        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), M::from_row)?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    pub fn upsert<M>(&self, model: &M, source: &UpdateSource) -> Result<M>
    where
        M: Into<AnyModel> + From<AnyModel> + UpsertModelInfo + Clone,
    {
        self.upsert_one(
            M::table_name(),
            M::id_column(),
            model.get_id().as_str(),
            || generate_model_id(ModelType::TypeEnvironment),
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
        gen_id: fn() -> String,
        other_values: Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>,
        update_columns: Vec<impl IntoIden>,
        source: &UpdateSource,
    ) -> Result<M>
    where
        M: Into<AnyModel> + From<AnyModel> + UpsertModelInfo + Clone,
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
        let m: M = stmt.query_row(&*params.as_params(), |row| M::from_row(row))?;

        let payload = ModelPayload {
            model: m.clone().into(),
            update_source: source.clone(),
            change: ModelChangeEvent::Upsert,
        };
        self.tx.try_send(payload).unwrap();

        Ok(m)
    }

    pub(crate) fn delete<'s, M>(&self, m: &M, update_source: &UpdateSource) -> Result<M>
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
            update_source: update_source.clone(),
            change: ModelChangeEvent::Delete,
        };

        self.tx.try_send(payload).unwrap();
        Ok(m.clone())
    }
}
