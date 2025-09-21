use crate::db_context::DbContext;
use crate::error::Error::{
    MissingBaseEnvironment, MultipleBaseEnvironments, MultipleFolderEnvironments,
};
use crate::error::Result;
use crate::models::{Environment, EnvironmentIden, EnvironmentVariable};
use crate::util::UpdateSource;
use log::info;

impl<'a> DbContext<'a> {
    pub fn get_environment(&self, id: &str) -> Result<Environment> {
        self.find_one(EnvironmentIden::Id, id)
    }

    pub fn get_environment_by_folder_id(&self, folder_id: &str) -> Result<Option<Environment>> {
        let environments: Vec<Environment> =
            self.find_many(EnvironmentIden::ParentId, folder_id, None)?;
        if environments.len() > 1 {
            return Err(MultipleFolderEnvironments(folder_id.to_string()));
        }

        Ok(environments.get(0).cloned())
    }

    pub fn get_base_environment(&self, workspace_id: &str) -> Result<Environment> {
        let environments = self.list_environments_ensure_base(workspace_id)?;
        let base_environments = environments
            .into_iter()
            .filter(|e| e.parent_id.is_none())
            .collect::<Vec<Environment>>();

        if base_environments.len() > 1 {
            return Err(MultipleBaseEnvironments(workspace_id.to_string()));
        }

        Ok(base_environments.first().cloned().ok_or(
            // Should never happen because one should be created above if it does not exist
            MissingBaseEnvironment(workspace_id.to_string()),
        )?)
    }

    /// Lists environments and will create a base environment if one doesn't exist
    pub fn list_environments_ensure_base(&self, workspace_id: &str) -> Result<Vec<Environment>> {
        let mut environments =
            self.find_many::<Environment>(EnvironmentIden::WorkspaceId, workspace_id, None)?;

        let base_environment = environments.iter().find(|e| e.parent_id.is_none());

        if let None = base_environment {
            let e = self.upsert_environment(
                &Environment {
                    workspace_id: workspace_id.to_string(),
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

    pub fn resolve_environments(
        &self,
        workspace_id: &str,
        folder_id: Option<&str>,
        active_environment_id: Option<&str>,
    ) -> Result<Vec<Environment>> {
        let mut environments = Vec::new();

        if let Some(folder_id) = folder_id {
            let folder = self.get_folder(folder_id)?;

            // Add current folder's environment
            if let Some(e) = self.get_environment_by_folder_id(folder_id)? {
                environments.push(e);
            };

            // Recurse up
            let ancestors = self.resolve_environments(
                workspace_id,
                folder.folder_id.as_deref(),
                active_environment_id,
            )?;
            environments.extend(ancestors);
        } else {
            // Add active and base environments
            if let Some(id) = active_environment_id {
                if let Ok(e) = self.get_environment(&id) {
                    // Add active sub environment
                    environments.push(e);
                };
            };

            // Add the base environment
            environments.push(self.get_base_environment(workspace_id)?);
        }

        Ok(environments)
    }
}
