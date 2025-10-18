use chrono::NaiveDateTime;
use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{KeyValue, KeyValueIden, UpsertModelInfo};
use crate::util::UpdateSource;
use log::error;
use sea_query::{Asterisk, Cond, Expr, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;

impl<'a> DbContext<'a> {
    pub fn list_key_values(&self) -> Result<Vec<KeyValue>> {
        let (sql, params) = Query::select()
            .from(KeyValueIden::Table)
            .column(Asterisk)
            // Temporary clause to prevent bug when reverting to the previous version, before the
            // ID column was added. A previous version will not know about ID and will create
            // key/value entries that don't have one. This clause ensures they are not queried
            // TODO: Add migration to delete key/values with NULL IDs later on, then remove this
            .cond_where(Expr::col(KeyValueIden::Id).is_not_null())
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), KeyValue::from_row)?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    pub fn get_key_value_str(&self, namespace: &str, key: &str, default: &str) -> String {
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

    pub fn get_key_value_dte(&self, namespace: &str, key: &str, default: NaiveDateTime) -> NaiveDateTime {
        match self.get_key_value_raw(namespace, key) {
            None => default,
            Some(v) => {
                let result = serde_json::from_str(&v.value);
                match result {
                    Ok(v) => v,
                    Err(e) => {
                        error!("Failed to parse date key value: {}", e);
                        default
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
        self.conn.resolve().query_row(sql.as_str(), &*params.as_params(), KeyValue::from_row).ok()
    }

    pub fn set_key_value_dte(
        &self,
        namespace: &str,
        key: &str,
        value: NaiveDateTime,
        source: &UpdateSource,
    ) -> (KeyValue, bool) {
        let encoded = serde_json::to_string(&value).unwrap();
        self.set_key_value_raw(namespace, key, &encoded, source)
    }

    pub fn set_key_value_str(
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
        match self.get_key_value_raw(namespace, key) {
            None => (
                self.upsert_key_value(
                    &KeyValue {
                        namespace: namespace.to_string(),
                        key: key.to_string(),
                        value: value.to_string(),
                        ..Default::default()
                    },
                    source,
                )
                .expect("Failed to create key value"),
                true,
            ),
            Some(kv) => (
                self.upsert_key_value(
                    &KeyValue {
                        value: value.to_string(),
                        ..kv
                    },
                    source,
                )
                .expect("Failed to update key value"),
                false,
            ),
        }
    }

    pub fn upsert_key_value(
        &self,
        key_value: &KeyValue,
        source: &UpdateSource,
    ) -> Result<KeyValue> {
        self.upsert(key_value, source)
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

        self.delete(&kv, source)?;
        Ok(())
    }
}
