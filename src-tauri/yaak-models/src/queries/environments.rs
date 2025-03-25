use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{Environment, EnvironmentIden, UpsertModelInfo};
use crate::queries_legacy::UpdateSource;
use log::info;
use sea_query::ColumnRef::Asterisk;
use sea_query::{Cond, Expr, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;

impl<'a> DbContext<'a> {
    pub fn get_environment(&self, id: &str) -> Result<Environment> {
        self.find_one(EnvironmentIden::Id, id)
    }

    pub fn get_base_environment(&self, workspace_id: &str) -> Result<Environment> {
        let (sql, params) = Query::select()
            .from(EnvironmentIden::Table)
            .column(Asterisk)
            .cond_where(
                Cond::all()
                    .add(Expr::col(EnvironmentIden::WorkspaceId).eq(workspace_id))
                    .add(Expr::col(EnvironmentIden::EnvironmentId).is_null()),
            )
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.prepare(sql.as_str())?;
        Ok(stmt.query_row(&*params.as_params(), Environment::from_row)?)
    }

    pub fn ensure_base_environment(&self, workspace_id: &str) -> Result<()> {
        let environments = self.list_environments(workspace_id)?;
        let base_environment = environments
            .iter()
            .find(|e| e.environment_id == None && e.workspace_id == workspace_id);

        if let None = base_environment {
            info!("Creating base environment for {workspace_id}");
            self.upsert_environment(
                &Environment {
                    workspace_id: workspace_id.to_string(),
                    name: "Global Variables".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Background,
            )?;
        }

        Ok(())
    }

    pub fn list_environments(&self, workspace_id: &str) -> Result<Vec<Environment>> {
        self.find_many(EnvironmentIden::WorkspaceId, workspace_id, None)
    }

    pub fn delete_environment(
        &self,
        environment: &Environment,
        source: &UpdateSource,
    ) -> Result<Environment> {
        for environment in
            self.find_many::<Environment>(EnvironmentIden::EnvironmentId, &environment.id, None)?
        {
            self.delete_environment(&environment, source)?;
        }
        self.delete(environment, source)
    }

    pub fn delete_environment_by_id(&self, id: &str, source: &UpdateSource) -> Result<Environment> {
        let environment = self.get_environment(id)?;
        self.delete_environment(&environment, source)
    }

    pub fn upsert_environment(
        &self,
        environment: &Environment,
        source: &UpdateSource,
    ) -> Result<Environment> {
        self.upsert(environment, source)
    }
}
