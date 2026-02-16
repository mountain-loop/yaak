use crate::connection_or_tx::ConnectionOrTx;
use crate::error::Error::ModelNotFound;
use crate::error::Result;
use crate::models::{AnyModel, UpsertModelInfo};
use crate::util::{ModelChangeEvent, ModelPayload, UpdateSource};
use rusqlite::types::Type;
use rusqlite::{OptionalExtension, params};
use sea_query::{
    Asterisk, Expr, Func, IntoColumnRef, IntoIden, IntoTableRef, OnConflict, Query, SimpleExpr,
    SqliteQueryBuilder,
};
use sea_query_rusqlite::RusqliteBinder;
use std::fmt::Debug;
use std::sync::mpsc;

pub struct DbContext<'a> {
    pub(crate) _events_tx: mpsc::Sender<ModelPayload>,
    pub(crate) conn: ConnectionOrTx<'a>,
}

#[derive(Debug, Clone)]
pub struct PersistedModelChange {
    pub id: i64,
    pub payload: ModelPayload,
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
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(ModelNotFound(format!(
                r#"table "{}" {} == {}"#,
                M::table_name().into_iden().to_string(),
                col.into_iden().to_string(),
                value_debug
            ))),
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

    pub(crate) fn find_all<'s, M>(&self) -> Result<Vec<M>>
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

    pub(crate) fn find_many<'s, M>(
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

    pub(crate) fn upsert<M>(&self, model: &M, source: &UpdateSource) -> Result<M>
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
    ) -> Result<M>
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

        let payload = ModelPayload {
            model: m.clone().into(),
            update_source: source.clone(),
            change: ModelChangeEvent::Upsert { created },
        };

        self.record_model_change(&payload)?;
        let _ = self._events_tx.send(payload);

        Ok(m)
    }

    pub(crate) fn delete<'s, M>(&self, m: &M, source: &UpdateSource) -> Result<M>
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

        self.record_model_change(&payload)?;
        let _ = self._events_tx.send(payload);

        Ok(m.clone())
    }

    fn record_model_change(&self, payload: &ModelPayload) -> Result<()> {
        let payload_json = serde_json::to_string(payload)?;
        let source_json = serde_json::to_string(&payload.update_source)?;
        let change_json = serde_json::to_string(&payload.change)?;

        self.conn.resolve().execute(
            r#"
                INSERT INTO model_changes (model, model_id, change, update_source, payload)
                VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                payload.model.model(),
                payload.model.id(),
                change_json,
                source_json,
                payload_json,
            ],
        )?;

        Ok(())
    }

    pub fn latest_model_change_id(&self) -> Result<i64> {
        let mut stmt = self.conn.prepare("SELECT COALESCE(MAX(id), 0) FROM model_changes")?;
        Ok(stmt.query_row([], |row| row.get(0))?)
    }

    pub fn list_model_changes_after(
        &self,
        after_id: i64,
        limit: usize,
    ) -> Result<Vec<PersistedModelChange>> {
        let mut stmt = self.conn.prepare(
            r#"
                SELECT id, payload
                FROM model_changes
                WHERE id > ?1
                ORDER BY id ASC
                LIMIT ?2
            "#,
        )?;

        let items = stmt.query_map(params![after_id, limit as i64], |row| {
            let id: i64 = row.get(0)?;
            let payload_raw: String = row.get(1)?;
            let payload = serde_json::from_str::<ModelPayload>(&payload_raw).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(1, Type::Text, Box::new(e))
            })?;
            Ok(PersistedModelChange { id, payload })
        })?;

        Ok(items.collect::<std::result::Result<Vec<_>, rusqlite::Error>>()?)
    }

    pub fn prune_model_changes_older_than_days(&self, days: i64) -> Result<usize> {
        let offset = format!("-{days} days");
        Ok(self.conn.resolve().execute(
            r#"
                DELETE FROM model_changes
                WHERE created_at < STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW', ?1)
            "#,
            params![offset],
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_in_memory;
    use crate::models::Workspace;

    #[test]
    fn records_model_changes_for_upsert_and_delete() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();

        let workspace = db
            .upsert_workspace(
                &Workspace {
                    name: "Changes Test".to_string(),
                    setting_follow_redirects: true,
                    setting_validate_certificates: true,
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )
            .expect("Failed to upsert workspace");

        let created_changes = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(created_changes.len(), 1);
        assert_eq!(created_changes[0].payload.model.id(), workspace.id);
        assert_eq!(created_changes[0].payload.model.model(), "workspace");
        assert!(matches!(
            created_changes[0].payload.change,
            ModelChangeEvent::Upsert { created: true }
        ));
        assert!(matches!(created_changes[0].payload.update_source, UpdateSource::Sync));

        db.delete_workspace_by_id(&workspace.id, &UpdateSource::Sync)
            .expect("Failed to delete workspace");

        let all_changes = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(all_changes.len(), 2);
        assert!(matches!(all_changes[1].payload.change, ModelChangeEvent::Delete));
        assert_eq!(
            db.latest_model_change_id().expect("Failed to read latest ID"),
            all_changes[1].id
        );

        let changes_after_first = db
            .list_model_changes_after(all_changes[0].id, 10)
            .expect("Failed to list changes after cursor");
        assert_eq!(changes_after_first.len(), 1);
        assert!(matches!(changes_after_first[0].payload.change, ModelChangeEvent::Delete));
    }

    #[test]
    fn prunes_old_model_changes() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();

        db.upsert_workspace(
            &Workspace {
                name: "Prune Test".to_string(),
                setting_follow_redirects: true,
                setting_validate_certificates: true,
                ..Default::default()
            },
            &UpdateSource::Sync,
        )
        .expect("Failed to upsert workspace");

        let changes = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(changes.len(), 1);

        db.conn
            .resolve()
            .execute(
                "UPDATE model_changes SET created_at = '2000-01-01 00:00:00.000' WHERE id = ?1",
                params![changes[0].id],
            )
            .expect("Failed to age model change row");

        let pruned =
            db.prune_model_changes_older_than_days(30).expect("Failed to prune model changes");
        assert_eq!(pruned, 1);
        assert!(db.list_model_changes_after(0, 10).expect("Failed to list changes").is_empty());
    }
}
