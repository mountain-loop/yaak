use crate::error::Result;
use crate::models::{KeyValue, KeyValueIden};
use crate::util::{ModelChangeEvent, ModelPayload, UpdateSource};
use log::error;
use sea_query::Keyword::CurrentTimestamp;
use sea_query::{Asterisk, Cond, Expr, OnConflict, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use crate::db_context::DbContext;

impl<'a> DbContext<'a> {
    pub fn list_key_values_raw(&self) -> Result<Vec<KeyValue>> {
        let (sql, params) = Query::select()
            .from(KeyValueIden::Table)
            .column(Asterisk)
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    pub fn get_key_value_string(&self, namespace: &str, key: &str, default: &str) -> String {
        match self.get_key_value_raw(namespace, key) {
            None => default.to_string(),
            Some(v) => {
                let result = serde_json::from_str(&v.value);
                match result {
                    Ok(v) => v,
                    Err(e) => {
                        error!("Failed to parse string key value: {}", e);
                        default.to_string()
                    }
                }
            }
        }
    }

    pub fn get_key_value_int(&self, namespace: &str, key: &str, default: i32) -> i32 {
        match self.get_key_value_raw(namespace, key) {
            None => default.clone(),
            Some(v) => {
                let result = serde_json::from_str(&v.value);
                match result {
                    Ok(v) => v,
                    Err(e) => {
                        error!("Failed to parse int key value: {}", e);
                        default.clone()
                    }
                }
            }
        }
    }

    pub fn get_key_value_raw(&self, namespace: &str, key: &str) -> Option<KeyValue> {
        let (sql, params) = Query::select()
            .from(KeyValueIden::Table)
            .column(Asterisk)
            .cond_where(
                Cond::all()
                    .add(Expr::col(KeyValueIden::Namespace).eq(namespace))
                    .add(Expr::col(KeyValueIden::Key).eq(key)),
            )
            .build_rusqlite(SqliteQueryBuilder);
        self.conn.resolve().query_row(sql.as_str(), &*params.as_params(), |row| row.try_into()).ok()
    }

    pub fn set_key_value_string(
        &self,
        namespace: &str,
        key: &str,
        value: &str,
        source: &UpdateSource,
    ) -> (KeyValue, bool) {
        let encoded = serde_json::to_string(&value).unwrap();
        self.set_key_value_raw(namespace, key, &encoded, source)
    }

    pub fn set_key_value_int(
        &self,
        namespace: &str,
        key: &str,
        value: i32,
        source: &UpdateSource,
    ) -> (KeyValue, bool) {
        let encoded = serde_json::to_string(&value).unwrap();
        self.set_key_value_raw(namespace, key, &encoded, source)
    }

    pub fn set_key_value_raw(
        &self,
        namespace: &str,
        key: &str,
        value: &str,
        source: &UpdateSource,
    ) -> (KeyValue, bool) {
        let existing = self.get_key_value_raw(namespace, key);

        let (sql, params) = Query::insert()
            .into_table(KeyValueIden::Table)
            .columns([
                KeyValueIden::CreatedAt,
                KeyValueIden::UpdatedAt,
                KeyValueIden::Namespace,
                KeyValueIden::Key,
                KeyValueIden::Value,
            ])
            .values_panic([
                CurrentTimestamp.into(),
                CurrentTimestamp.into(),
                namespace.into(),
                key.into(),
                value.into(),
            ])
            .on_conflict(
                OnConflict::new()
                    .update_columns([KeyValueIden::UpdatedAt, KeyValueIden::Value])
                    .to_owned(),
            )
            .returning_all()
            .build_rusqlite(SqliteQueryBuilder);

        let mut stmt = self.conn.prepare(sql.as_str()).expect("Failed to prepare KeyValue upsert");
        let m: KeyValue = stmt
            .query_row(&*params.as_params(), |row| row.try_into())
            .expect("Failed to upsert KeyValue");

        let payload = ModelPayload {
            model: m.clone().into(),
            update_source: source.clone(),
            change: ModelChangeEvent::Upsert,
        };
        self.tx.try_send(payload).unwrap();

        (m, existing.is_none())
    }

    pub fn delete_key_value(
        &self,
        namespace: &str,
        key: &str,
        source: &UpdateSource,
    ) -> Result<()> {
        let kv = match self.get_key_value_raw(namespace, key) {
            None => return Ok(()),
            Some(m) => m,
        };

        let (sql, params) = Query::delete()
            .from_table(KeyValueIden::Table)
            .cond_where(
                Cond::all()
                    .add(Expr::col(KeyValueIden::Namespace).eq(namespace))
                    .add(Expr::col(KeyValueIden::Key).eq(key)),
            )
            .build_rusqlite(SqliteQueryBuilder);
        self.conn.execute(sql.as_str(), &*params.as_params())?;
        let payload = ModelPayload {
            model: kv.clone().into(),
            update_source: source.clone(),
            change: ModelChangeEvent::Delete,
        };
        self.tx.try_send(payload).unwrap();
        Ok(())
    }
}
