use crate::db_context::DbContext;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::models::{Environment, EnvironmentIden};
use crate::util::UpdateSource;

impl<'a> DbContext<'a> {
    pub fn get_environment(&self, id: &str) -> Result<Environment> {
        self.find_one(EnvironmentIden::Id, id)
    }

    pub fn get_base_environment(&self, workspace_id: &str) -> Result<Environment> {
        // Will create base environment if it doesn't exist
        let environments = self.list_environments(workspace_id)?;

        let base_environment = environments
            .into_iter()
            .find(|e| e.environment_id == None && e.workspace_id == workspace_id)
            .ok_or(GenericError(format!("No base environment found for {workspace_id}")))?;

        Ok(base_environment)
    }

    pub fn list_environments(&self, workspace_id: &str) -> Result<Vec<Environment>> {
        let mut environments =
            self.find_many::<Environment>(EnvironmentIden::WorkspaceId, workspace_id, None)?;

        let base_environment = environments
            .iter()
            .find(|e| e.environment_id == None && e.workspace_id == workspace_id);

        if let None = base_environment {
            environments.push(self.upsert_environment(
                &Environment {
                    workspace_id: workspace_id.to_string(),
                    environment_id: None,
                    name: "Global Variables".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Background,
            )?);
        }

        Ok(environments)
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

    pub fn duplicate_environment(
        &self,
        environment: &Environment,
        source: &UpdateSource,
    ) -> Result<Environment> {
        let mut environment = environment.clone();
        environment.id = "".to_string();
        self.upsert(&environment, source)
    }

    pub fn upsert_environment(
        &self,
        environment: &Environment,
        source: &UpdateSource,
    ) -> Result<Environment> {
        self.upsert(environment, source)
    }
}
