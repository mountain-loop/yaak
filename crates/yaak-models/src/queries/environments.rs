use super::conflict_free_name;
use crate::client_db::{ClientDb, WriteDb};
use crate::error::Error::{MissingBaseEnvironment, MultipleBaseEnvironments};
use crate::error::Result;
use crate::models::{Environment, EnvironmentIden, EnvironmentVariable};
use crate::util::UpdateSource;
use log::{info, warn};

impl<'a> ClientDb<'a> {
    pub fn get_environment(&self, id: &str) -> Result<Environment> {
        self.find_one(EnvironmentIden::Id, id)
    }

    /// Resolve an explicit execution environment, rejecting foreign and folder environments.
    /// Folder variables are inherited from the request's folder, never selected globally.
    pub fn get_environment_for_workspace(
        &self,
        workspace_id: &str,
        environment_id: &str,
    ) -> Result<Environment> {
        let environment = self.get_environment(environment_id)?;
        if environment.workspace_id != workspace_id {
            return Err(crate::error::Error::InvalidEnvironment(format!(
                "Environment {environment_id} does not belong to workspace {workspace_id}"
            )));
        }
        if !matches!(environment.parent_model.as_str(), "workspace" | "environment") {
            return Err(crate::error::Error::InvalidEnvironment(format!(
                "Environment {environment_id} is not a workspace environment"
            )));
        }
        Ok(environment)
    }

    pub fn get_environment_by_folder_id(&self, folder_id: &str) -> Result<Option<Environment>> {
        let mut environments: Vec<Environment> =
            self.find_many(EnvironmentIden::ParentId, folder_id, None)?;
        // Sort so we return the most recently updated environment
        environments.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(environments.get(0).cloned())
    }

    pub fn get_base_environment(&self, workspace_id: &str) -> Result<Environment> {
        let environments = self.list_environments(workspace_id)?;
        let base_environments = environments
            .into_iter()
            .filter(|e| e.parent_model == "workspace")
            .collect::<Vec<Environment>>();

        if base_environments.len() > 1 {
            return Err(MultipleBaseEnvironments(workspace_id.to_string()));
        }

        Ok(base_environments
            .first()
            .cloned()
            .ok_or(MissingBaseEnvironment(workspace_id.to_string()))?)
    }

    pub fn list_environments(&self, workspace_id: &str) -> Result<Vec<Environment>> {
        Ok(self.find_many::<Environment>(EnvironmentIden::WorkspaceId, workspace_id, None)?)
    }

    /// Find other environments with the same parent folder
    fn list_duplicate_folder_environments(&self, environment: &Environment) -> Vec<Environment> {
        if environment.parent_model != "folder" {
            return Vec::new();
        }

        self.list_environments(&environment.workspace_id)
            .unwrap_or_default()
            .into_iter()
            .filter(|e| {
                e.id != environment.id
                    && e.parent_model == "folder"
                    && e.parent_id == environment.parent_id
            })
            .collect()
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

            // Add the base environment. A workspace that has never been
            // opened has none yet; it simply contributes no variables.
            match self.get_base_environment(workspace_id) {
                Ok(e) => environments.push(e),
                Err(MissingBaseEnvironment(_)) => {}
                Err(e) => return Err(e),
            }
        }

        Ok(environments)
    }
}

impl<'a> WriteDb<'a> {
    /// The workspace's base environment, created if it does not exist.
    pub fn ensure_base_environment(&self, workspace_id: &str) -> Result<Environment> {
        match self.get_base_environment(workspace_id) {
            Err(MissingBaseEnvironment(_)) => {}
            other => return other,
        }
        let e = self.upsert_environment(
            &Environment {
                workspace_id: workspace_id.to_string(),
                name: "Global Variables".to_string(),
                parent_model: "workspace".to_string(),
                ..Default::default()
            },
            &UpdateSource::Background,
        )?;
        info!("Created base environment {} for {workspace_id}", e.id);
        Ok(e)
    }

    pub fn delete_environment(
        &self,
        environment: &Environment,
        source: &UpdateSource,
    ) -> Result<Environment> {
        let deleted_environment = self.delete(environment, source)?;

        // Recreate the base environment if we happened to delete it
        self.ensure_base_environment(&environment.workspace_id)?;

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
        let sibling_names = self
            .list_environments(&environment.workspace_id)?
            .into_iter()
            .map(|e| e.name)
            .collect::<Vec<_>>();
        environment.name = conflict_free_name(&environment.name, &sibling_names);
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

        // Sometimes a new environment can be created via sync/import, so we'll just delete
        // the others when that happens. Not the best, but it's good for now.
        let duplicates = self.list_duplicate_folder_environments(environment);
        for duplicate in duplicates {
            warn!(
                "Deleting duplicate environment {} for folder {:?}",
                duplicate.id, environment.parent_id
            );
            _ = self.delete(&duplicate, source);
        }

        // Automatically update the environment name based on the folder name
        let mut name = environment.name.clone();
        match (environment.parent_model.as_str(), environment.parent_id.as_deref()) {
            ("folder", Some(folder_id)) => {
                if let Ok(folder) = self.get_folder(folder_id) {
                    name = format!("{} Environment", folder.name);
                }
            }
            _ => {}
        }

        self.upsert(
            &Environment { name, variables: cleaned_variables, ..environment.clone() },
            source,
        )
    }
}

#[cfg(test)]
mod tests {
    use crate::error::Error;
    use crate::init_in_memory;
    use crate::models::{Environment, EnvironmentVariable, Folder, Workspace};
    use crate::query_manager::QueryManager;
    use crate::render::make_vars_hashmap;
    use crate::util::UpdateSource;

    fn fixture() -> (QueryManager, Environment, Environment, Environment) {
        let (manager, _blobs, _rx) = init_in_memory().unwrap();
        let source = &UpdateSource::Background;
        let (base, staging, folder) = manager
            .with_tx(|db| {
                // Fresh databases no longer come with a workspace, so make one
                let workspace = db.upsert_workspace(
                    &Workspace { name: "Test".into(), ..Default::default() },
                    source,
                )?;
                let variable = |name: &str, value: &str| EnvironmentVariable {
                    enabled: true,
                    name: name.into(),
                    value: value.into(),
                    ..Default::default()
                };
                let base = db.ensure_base_environment(&workspace.id)?;
                let base = db.upsert_environment(
                    &Environment {
                        variables: vec![
                            variable("marker", "global"),
                            variable("global_only", "inherited"),
                        ],
                        ..base
                    },
                    source,
                )?;
                let staging = db.upsert_environment(
                    &Environment {
                        workspace_id: workspace.id.clone(),
                        parent_model: "environment".into(),
                        parent_id: Some(base.id.clone()),
                        name: "Staging".into(),
                        variables: vec![variable("marker", "staging")],
                        ..Default::default()
                    },
                    source,
                )?;
                let folder = db.upsert_folder(
                    &Folder {
                        workspace_id: workspace.id.clone(),
                        name: "Folder".into(),
                        ..Default::default()
                    },
                    source,
                )?;
                let folder = db.upsert_environment(
                    &Environment {
                        workspace_id: workspace.id,
                        parent_model: "folder".into(),
                        parent_id: Some(folder.id),
                        variables: vec![variable("marker", "folder")],
                        ..Default::default()
                    },
                    source,
                )?;
                Ok::<_, Error>((base, staging, folder))
            })
            .unwrap();
        (manager, base, staging, folder)
    }

    #[test]
    fn explicit_environment_preserves_global_and_folder_inheritance() {
        let (manager, base, staging, folder) = fixture();
        let db = manager.connect();
        let selected = db.get_environment_for_workspace(&base.workspace_id, &staging.id).unwrap();
        let vars = make_vars_hashmap(
            db.resolve_environments(&base.workspace_id, None, Some(&selected.id)).unwrap(),
        );
        assert_eq!(vars["marker"], "staging");
        assert_eq!(vars["global_only"], "inherited");

        let vars = make_vars_hashmap(
            db.resolve_environments(
                &base.workspace_id,
                folder.parent_id.as_deref(),
                Some(&selected.id),
            )
            .unwrap(),
        );
        assert_eq!(vars["marker"], "folder");
        assert_eq!(vars["global_only"], "inherited");
    }

    #[test]
    fn base_environment_can_be_selected_explicitly() {
        let (manager, base, _staging, _folder) = fixture();
        let db = manager.connect();
        let selected = db.get_environment_for_workspace(&base.workspace_id, &base.id).unwrap();
        let vars = make_vars_hashmap(
            db.resolve_environments(&base.workspace_id, None, Some(&selected.id)).unwrap(),
        );
        assert_eq!(vars["marker"], "global");
    }

    #[test]
    fn explicit_environment_rejects_empty_and_missing_ids() {
        let (manager, base, _staging, _folder) = fixture();
        for id in ["", "ev_missing"] {
            assert!(matches!(
                manager.connect().get_environment_for_workspace(&base.workspace_id, id),
                Err(Error::ModelNotFound(_))
            ));
        }
    }

    #[test]
    fn explicit_environment_rejects_another_workspace() {
        let (manager, _base, staging, _folder) = fixture();
        let other = manager
            .with_tx(|db| {
                db.upsert_workspace(
                    &Workspace { name: "Other".into(), ..Default::default() },
                    &UpdateSource::Background,
                )
            })
            .unwrap();
        assert!(matches!(
            manager.connect().get_environment_for_workspace(&other.id, &staging.id),
            Err(Error::InvalidEnvironment(_))
        ));
    }

    #[test]
    fn explicit_environment_rejects_folder_variables() {
        let (manager, base, _staging, folder) = fixture();
        assert!(matches!(
            manager.connect().get_environment_for_workspace(&base.workspace_id, &folder.id),
            Err(Error::InvalidEnvironment(_))
        ));
    }
}
