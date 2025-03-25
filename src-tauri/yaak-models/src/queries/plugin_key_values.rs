use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{PluginKeyValue, PluginKeyValueIden};
use sea_query::Keyword::CurrentTimestamp;
use sea_query::{Asterisk, Cond, Expr, OnConflict, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;

impl<'a> DbContext<'a> {
    pub fn get_plugin_key_value(&self, plugin_name: &str, key: &str) -> Option<PluginKeyValue> {
        let (sql, params) = Query::select()
            .from(PluginKeyValueIden::Table)
            .column(Asterisk)
            .cond_where(
                Cond::all()
                    .add(Expr::col(PluginKeyValueIden::PluginName).eq(plugin_name))
                    .add(Expr::col(PluginKeyValueIden::Key).eq(key)),
            )
            .build_rusqlite(SqliteQueryBuilder);
        self.conn.resolve().query_row(sql.as_str(), &*params.as_params(), |row| row.try_into()).ok()
    }

    pub fn set_plugin_key_value(
        &self,
        plugin_name: &str,
        key: &str,
        value: &str,
    ) -> (PluginKeyValue, bool) {
        let existing = self.get_plugin_key_value(plugin_name, key);

        let (sql, params) = Query::insert()
            .into_table(PluginKeyValueIden::Table)
            .columns([
                PluginKeyValueIden::CreatedAt,
                PluginKeyValueIden::UpdatedAt,
                PluginKeyValueIden::PluginName,
                PluginKeyValueIden::Key,
                PluginKeyValueIden::Value,
            ])
            .values_panic([
                CurrentTimestamp.into(),
                CurrentTimestamp.into(),
                plugin_name.into(),
                key.into(),
                value.into(),
            ])
            .on_conflict(
                OnConflict::new()
                    .update_columns([PluginKeyValueIden::UpdatedAt, PluginKeyValueIden::Value])
                    .to_owned(),
            )
            .returning_all()
            .build_rusqlite(SqliteQueryBuilder);

        let mut stmt =
            self.conn.prepare(sql.as_str()).expect("Failed to prepare PluginKeyValue upsert");
        let m: PluginKeyValue = stmt
            .query_row(&*params.as_params(), |row| row.try_into())
            .expect("Failed to upsert KeyValue");

        (m, existing.is_none())
    }

    pub fn delete_plugin_key_value(&self, namespace: &str, key: &str) -> Result<bool> {
        if let None = self.get_plugin_key_value(namespace, key) {
            return Ok(false);
        };

        let (sql, params) = Query::delete()
            .from_table(PluginKeyValueIden::Table)
            .cond_where(
                Cond::all()
                    .add(Expr::col(PluginKeyValueIden::PluginName).eq(namespace))
                    .add(Expr::col(PluginKeyValueIden::Key).eq(key)),
            )
            .build_rusqlite(SqliteQueryBuilder);
        self.conn.execute(sql.as_str(), &*params.as_params())?;
        Ok(true)
    }
}
