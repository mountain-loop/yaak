use crate::client_db::ClientDb;
use crate::error::Result;
use crate::models::{ImportSourceResource, ImportSourceResourceIden};
use sea_query::ExprTrait;
use sea_query::Keyword::CurrentTimestamp;
use sea_query::{Asterisk, Cond, Expr, OnConflict, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;

impl<'a> ClientDb<'a> {
    pub fn list_import_source_resources(
        &self,
        import_source_id: &str,
    ) -> Result<Vec<ImportSourceResource>> {
        let (sql, params) = Query::select()
            .from(ImportSourceResourceIden::Table)
            .column(Asterisk)
            .cond_where(Expr::col(ImportSourceResourceIden::ImportSourceId).eq(import_source_id))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
        Ok(items.filter_map(|v| v.ok()).collect())
    }

    pub fn upsert_import_source_resource(
        &self,
        resource: &ImportSourceResource,
    ) -> Result<ImportSourceResource> {
        let (sql, params) = Query::insert()
            .into_table(ImportSourceResourceIden::Table)
            .columns([
                ImportSourceResourceIden::CreatedAt,
                ImportSourceResourceIden::UpdatedAt,
                ImportSourceResourceIden::ImportSourceId,
                ImportSourceResourceIden::SourceKey,
                ImportSourceResourceIden::ModelType,
                ImportSourceResourceIden::ModelId,
                ImportSourceResourceIden::Snapshot,
            ])
            .values_panic([
                CurrentTimestamp.into(),
                CurrentTimestamp.into(),
                resource.import_source_id.as_str().into(),
                resource.source_key.as_str().into(),
                resource.model_type.as_str().into(),
                resource.model_id.as_str().into(),
                resource.snapshot.as_str().into(),
            ])
            .on_conflict(
                OnConflict::columns([
                    ImportSourceResourceIden::ImportSourceId,
                    ImportSourceResourceIden::SourceKey,
                ])
                .update_columns([
                    ImportSourceResourceIden::UpdatedAt,
                    ImportSourceResourceIden::ModelType,
                    ImportSourceResourceIden::ModelId,
                    ImportSourceResourceIden::Snapshot,
                ])
                .to_owned(),
            )
            .returning_all()
            .build_rusqlite(SqliteQueryBuilder);

        let mut stmt = self.conn().prepare(sql.as_str())?;
        let m = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
        Ok(m)
    }

    pub fn delete_import_source_resource(
        &self,
        import_source_id: &str,
        source_key: &str,
    ) -> Result<()> {
        let (sql, params) = Query::delete()
            .from_table(ImportSourceResourceIden::Table)
            .cond_where(
                Cond::all()
                    .add(Expr::col(ImportSourceResourceIden::ImportSourceId).eq(import_source_id))
                    .add(Expr::col(ImportSourceResourceIden::SourceKey).eq(source_key)),
            )
            .build_rusqlite(SqliteQueryBuilder);
        self.conn().execute(sql.as_str(), &*params.as_params())?;
        Ok(())
    }

    pub fn delete_import_source_resources(&self, import_source_id: &str) -> Result<()> {
        let (sql, params) = Query::delete()
            .from_table(ImportSourceResourceIden::Table)
            .cond_where(Expr::col(ImportSourceResourceIden::ImportSourceId).eq(import_source_id))
            .build_rusqlite(SqliteQueryBuilder);
        self.conn().execute(sql.as_str(), &*params.as_params())?;
        Ok(())
    }
}
