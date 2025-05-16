use crate::db_context::DbContext;
use crate::error::Error::{MissingBaseEnvironment, MultipleBaseEnvironments};
use crate::error::Result;
use crate::models::{Environment, EnvironmentIden, EnvironmentVariable};
use crate::util::UpdateSource;
use log::info;

impl<'a> DbContext<'a> {
    pub fn get_environment(&self, id: &str) -> Result<Environment> {
        self.find_one(EnvironmentIden::Id, id)
    }

    pub fn get_base_environment(&self, workspace_id: &str) -> Result<Environment> {
        let environments = self.list_environments_ensure_base(workspace_id)?;
        let base_environments =
            environments.into_iter().filter(|e| e.base).collect::<Vec<Environment>>();

        if base_environments.len() > 1 {
            return Err(MultipleBaseEnvironments(workspace_id.to_string()));
        }

        let base_environment = base_environments.into_iter().find(|e| e.base).ok_or(
            // Should never happen because one should be created above if it does not exist
            MissingBaseEnvironment(workspace_id.to_string()),
        )?;

        Ok(base_environment)
    }

    /// Lists environments and will create a base environment if one doesn't exist
    pub fn list_environments_ensure_base(&self, workspace_id: &str) -> Result<Vec<Environment>> {
        let mut environments =
            self.find_many::<Environment>(EnvironmentIden::WorkspaceId, workspace_id, None)?;

        let base_environment = environments.iter().find(|e| e.base);

        if let None = base_environment {
            let e = self.upsert_environment(
                &Environment {
                    workspace_id: workspace_id.to_string(),
                    base: true,
                    name: "Global Variables".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Background,
            )?;
            info!("Created base environment {} for {workspace_id}", e.id);
            environments.push(e);
        }

        Ok(environments)
    }

    pub fn delete_environment(
        &self,
        environment: &Environment,
        source: &UpdateSource,
    ) -> Result<Environment> {
        let deleted_environment = self.delete(environment, source)?;

        // Recreate the base environment if we happened to delete it
        self.list_environments_ensure_base(&environment.workspace_id)?;

        Ok(deleted_environment)
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
        self.upsert_environment(&environment, source)
    }

    pub fn upsert_environment(
        &self,
        environment: &Environment,
        source: &UpdateSource,
    ) -> Result<Environment> {
        let cleaned_variables = environment
            .variables
            .iter()
            .filter(|v| !v.name.is_empty() || !v.value.is_empty())
            .cloned()
            .collect::<Vec<EnvironmentVariable>>();
        self.upsert(
            &Environment {
                variables: cleaned_variables,
                ..environment.clone()
            },
            source,
        )
    }
}
