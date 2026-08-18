use crate::Result;
use log::info;
use std::collections::{BTreeMap, BTreeSet};
use yaak_models::client_db::ClientDb;
use yaak_models::models::{
    DEFAULT_REQUEST_MESSAGE_SIZE, Environment, Folder, GrpcRequest, HttpRequest, UpsertModelInfo,
    WebsocketRequest, Workspace,
};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{
    BatchUpsertResult, ImportDestination, ImportPlan, ImportPlanResources, ImportPlanWarning,
    PlannedImportResource, UpdateSource,
};
use yaak_plugins::events::{ImportResources, PluginContext};
use yaak_plugins::manager::PluginManager;

pub struct PlanImportDataParams<'a> {
    pub query_manager: &'a QueryManager,
    pub plugin_manager: &'a PluginManager,
    pub plugin_context: &'a PluginContext,
    pub destination: ImportDestination,
    pub contents: &'a str,
}

/// Parse importer output and turn it into a commit-ready plan without mutating the database.
pub async fn plan_import_data(params: PlanImportDataParams<'_>) -> Result<ImportPlan> {
    let import_result =
        params.plugin_manager.import_data(params.plugin_context, params.contents).await?;

    plan_import_resources(
        params.query_manager,
        import_result.importer,
        params.destination,
        import_result.resources,
    )
}

/// Remap parsed importer resources into their selected destination.
///
/// Every imported model gets a fresh ID. This prevents an import from accidentally updating an
/// existing model and also makes the plan safe to inspect before it is committed.
pub fn plan_import_resources(
    query_manager: &QueryManager,
    importer: String,
    destination: ImportDestination,
    resources: ImportResources,
) -> Result<ImportPlan> {
    let mut warnings = Vec::new();
    validate_destination(query_manager, &destination)?;

    let source_folder_ids = resources.folders.iter().map(|v| v.id.clone()).collect::<BTreeSet<_>>();
    let mut folder_ids = BTreeMap::new();
    for folder in &resources.folders {
        folder_ids.insert(folder.id.clone(), Folder::generate_id());
    }

    let mut workspace_ids = BTreeMap::new();
    let mut workspaces = Vec::new();
    let (default_workspace_id, target_folder_id) = match &destination {
        ImportDestination::NewWorkspace => {
            for source in &resources.workspaces {
                let mut workspace = source.clone();
                workspace.id = Workspace::generate_id();
                workspace_ids.insert(source.id.clone(), workspace.id.clone());
                workspaces.push(PlannedImportResource::new(workspace));
            }

            if workspaces.is_empty() {
                let workspace = Workspace {
                    id: Workspace::generate_id(),
                    model: "workspace".to_string(),
                    name: format!("{} Import", display_importer_name(&importer)),
                    setting_follow_redirects: true,
                    setting_request_message_size: DEFAULT_REQUEST_MESSAGE_SIZE,
                    setting_validate_certificates: true,
                    setting_send_cookies: true,
                    setting_store_cookies: true,
                    ..Default::default()
                };
                workspaces.push(PlannedImportResource::new(workspace));
            }

            (workspaces[0].resource.id.clone(), None)
        }
        ImportDestination::CurrentWorkspace { workspace_id, folder_id } => {
            for source in &resources.workspaces {
                workspace_ids.insert(source.id.clone(), workspace_id.clone());
            }
            if !resources.workspaces.is_empty() {
                let destination_workspace = query_manager.connect().get_workspace(workspace_id)?;
                let skipped_fields = resources
                    .workspaces
                    .iter()
                    .flat_map(|source| {
                        workspace_fields_not_imported(source, &destination_workspace)
                    })
                    .collect::<BTreeSet<_>>();
                if !skipped_fields.is_empty() {
                    let source = if resources.workspaces.len() == 1 {
                        resources.workspaces[0].name.clone()
                    } else {
                        format!("{} imported workspaces", resources.workspaces.len())
                    };
                    warnings.push(ImportPlanWarning {
                        title: "Workspace settings skipped".to_string(),
                        detail: format!("{source} · {}", display_list(&skipped_fields)),
                    });
                }
            }
            (workspace_id.clone(), folder_id.clone())
        }
    };

    let resolve_workspace_id = |source_id: &str| {
        workspace_ids.get(source_id).cloned().unwrap_or_else(|| default_workspace_id.clone())
    };

    let resolve_folder_id = |source_id: Option<String>| match source_id {
        Some(source_id) if source_folder_ids.contains(&source_id) => {
            folder_ids.get(&source_id).cloned()
        }
        _ => target_folder_id.clone(),
    };

    let folders = resources
        .folders
        .into_iter()
        .map(|mut folder| {
            folder.id = folder_ids.get(&folder.id).cloned().unwrap_or_else(Folder::generate_id);
            folder.workspace_id = resolve_workspace_id(&folder.workspace_id);
            folder.folder_id = resolve_folder_id(folder.folder_id);
            PlannedImportResource::new(folder)
        })
        .collect();

    let http_requests = resources
        .http_requests
        .into_iter()
        .map(|mut request| {
            request.id = HttpRequest::generate_id();
            request.workspace_id = resolve_workspace_id(&request.workspace_id);
            request.folder_id = resolve_folder_id(request.folder_id);
            PlannedImportResource::new(request)
        })
        .collect();

    let grpc_requests = resources
        .grpc_requests
        .into_iter()
        .map(|mut request| {
            request.id = GrpcRequest::generate_id();
            request.workspace_id = resolve_workspace_id(&request.workspace_id);
            request.folder_id = resolve_folder_id(request.folder_id);
            PlannedImportResource::new(request)
        })
        .collect();

    let websocket_requests = resources
        .websocket_requests
        .into_iter()
        .map(|mut request| {
            request.id = WebsocketRequest::generate_id();
            request.workspace_id = resolve_workspace_id(&request.workspace_id);
            request.folder_id = resolve_folder_id(request.folder_id);
            PlannedImportResource::new(request)
        })
        .collect();

    let importing_into_current = matches!(destination, ImportDestination::CurrentWorkspace { .. });
    let mut separated_base_environments = Vec::new();
    let mut converted_duplicate_base_environment = false;
    let mut converted_duplicate_folder_environment = false;
    let mut base_environment_workspaces = BTreeSet::new();
    let mut folder_environment_ids = BTreeSet::new();
    let environments = resources
        .environments
        .into_iter()
        .map(|mut environment| {
            environment.id = Environment::generate_id();
            environment.workspace_id = resolve_workspace_id(&environment.workspace_id);

            match (environment.parent_model.as_str(), environment.parent_id.clone()) {
                ("workspace", _) if importing_into_current => {
                    environment.parent_model = "environment".to_string();
                    environment.parent_id = None;
                    let source_name = environment.name.clone();
                    environment.name = format!("{} (Imported)", environment.name);
                    separated_base_environments.push((
                        source_name,
                        environment.name.clone(),
                        environment.variables.len(),
                    ));
                }
                ("workspace", _) => {
                    environment.parent_id = None;
                    if !base_environment_workspaces.insert(environment.workspace_id.clone()) {
                        environment.parent_model = "environment".to_string();
                        environment.name = format!("{} (Imported)", environment.name);
                        converted_duplicate_base_environment = true;
                    }
                }
                ("folder", Some(parent_id)) if source_folder_ids.contains(&parent_id) => {
                    environment.parent_id = folder_ids.get(&parent_id).cloned();
                    if let Some(parent_id) = &environment.parent_id
                        && !folder_environment_ids.insert(parent_id.clone())
                    {
                        environment.parent_model = "environment".to_string();
                        environment.parent_id = None;
                        converted_duplicate_folder_environment = true;
                    }
                }
                ("folder", _) => {
                    // Never attach an imported folder environment to an existing folder: the model
                    // layer permits only one and would otherwise delete the destination's value.
                    environment.parent_model = "environment".to_string();
                    environment.parent_id = None;
                }
                ("environment", _) => {
                    environment.parent_id = None;
                }
                _ => {
                    environment.parent_model = "environment".to_string();
                    environment.parent_id = None;
                }
            }

            PlannedImportResource::new(environment)
        })
        .collect();

    for (source_name, imported_name, variable_count) in separated_base_environments {
        let variables = if variable_count == 1 { "variable" } else { "variables" };
        warnings.push(ImportPlanWarning {
            title: "Base environment kept separate".to_string(),
            detail: format!("{source_name} → {imported_name} · {variable_count} {variables}"),
        });
    }
    if converted_duplicate_base_environment {
        warnings.push(ImportPlanWarning {
            title: "Base environments separated".to_string(),
            detail: "Only the first remains the base environment".to_string(),
        });
    }
    if converted_duplicate_folder_environment {
        warnings.push(ImportPlanWarning {
            title: "Folder environments separated".to_string(),
            detail: "Only the first remains attached to each folder".to_string(),
        });
    }

    Ok(ImportPlan {
        importer,
        destination,
        resources: ImportPlanResources {
            workspaces,
            environments,
            folders,
            http_requests,
            grpc_requests,
            websocket_requests,
        },
        warnings,
    })
}

/// Commit a previously prepared plan in one transaction.
pub fn commit_import_plan(
    query_manager: &QueryManager,
    plan: ImportPlan,
) -> Result<BatchUpsertResult> {
    validate_plan(&plan)?;
    let resources = plan.resources.into_batch();

    info!("Committing staged import from {}", plan.importer);
    query_manager.with_tx(|tx| {
        validate_destination_db(tx, &plan.destination)?;
        tx.batch_upsert(
            resources.workspaces,
            resources.environments,
            resources.folders,
            resources.http_requests,
            resources.grpc_requests,
            resources.websocket_requests,
            &UpdateSource::Import,
        )
        .map_err(crate::Error::from)
    })
}

fn validate_destination(
    query_manager: &QueryManager,
    destination: &ImportDestination,
) -> Result<()> {
    let db = query_manager.connect();
    validate_destination_db(&db, destination)
}

fn validate_destination_db(db: &ClientDb<'_>, destination: &ImportDestination) -> Result<()> {
    let ImportDestination::CurrentWorkspace { workspace_id, folder_id } = destination else {
        return Ok(());
    };

    db.get_workspace(workspace_id)?;
    if let Some(folder_id) = folder_id {
        let folder = db.get_folder(folder_id)?;
        if folder.workspace_id != *workspace_id {
            return Err(yaak_models::error::Error::GenericError(format!(
                "Folder {folder_id} does not belong to workspace {workspace_id}"
            ))
            .into());
        }
    }
    Ok(())
}

fn validate_plan(plan: &ImportPlan) -> Result<()> {
    let invalid = |message: String| -> Result<()> {
        Err(yaak_models::error::Error::GenericError(message).into())
    };

    match &plan.destination {
        ImportDestination::CurrentWorkspace { workspace_id, .. } => {
            if !plan.resources.workspaces.is_empty() {
                return invalid(
                    "A current-workspace import plan must not contain workspace updates"
                        .to_string(),
                );
            }

            let all_workspace_ids = plan
                .resources
                .environments
                .iter()
                .map(|v| &v.resource.workspace_id)
                .chain(plan.resources.folders.iter().map(|v| &v.resource.workspace_id))
                .chain(plan.resources.http_requests.iter().map(|v| &v.resource.workspace_id))
                .chain(plan.resources.grpc_requests.iter().map(|v| &v.resource.workspace_id))
                .chain(plan.resources.websocket_requests.iter().map(|v| &v.resource.workspace_id));
            if all_workspace_ids.into_iter().any(|id| id != workspace_id) {
                return invalid(
                    "A current-workspace import plan contains resources for another workspace"
                        .to_string(),
                );
            }

            if plan.resources.environments.iter().any(|v| v.resource.parent_model == "workspace") {
                return invalid(
                    "A current-workspace import plan must not replace the base environment"
                        .to_string(),
                );
            }
        }
        ImportDestination::NewWorkspace => {
            let workspace_ids = plan
                .resources
                .workspaces
                .iter()
                .map(|v| v.resource.id.as_str())
                .collect::<BTreeSet<_>>();
            if workspace_ids.is_empty() {
                return invalid("A new-workspace import plan has no workspace".to_string());
            }
            let all_workspace_ids = plan
                .resources
                .environments
                .iter()
                .map(|v| v.resource.workspace_id.as_str())
                .chain(plan.resources.folders.iter().map(|v| v.resource.workspace_id.as_str()))
                .chain(
                    plan.resources.http_requests.iter().map(|v| v.resource.workspace_id.as_str()),
                )
                .chain(
                    plan.resources.grpc_requests.iter().map(|v| v.resource.workspace_id.as_str()),
                )
                .chain(
                    plan.resources
                        .websocket_requests
                        .iter()
                        .map(|v| v.resource.workspace_id.as_str()),
                );
            if all_workspace_ids.into_iter().any(|id| !workspace_ids.contains(id)) {
                return invalid(
                    "A new-workspace import plan contains resources outside its workspaces"
                        .to_string(),
                );
            }

            let mut base_environment_workspaces = BTreeSet::new();
            if plan.resources.environments.iter().any(|v| {
                v.resource.parent_model == "workspace"
                    && !base_environment_workspaces.insert(v.resource.workspace_id.as_str())
            }) {
                return invalid(
                    "A new-workspace import plan contains multiple base environments for one workspace"
                        .to_string(),
                );
            }
        }
    }

    let planned_folder_ids =
        plan.resources.folders.iter().map(|v| v.resource.id.as_str()).collect::<BTreeSet<_>>();
    if plan.resources.environments.iter().any(|v| {
        v.resource.parent_model == "folder"
            && v.resource.parent_id.as_deref().is_none_or(|id| !planned_folder_ids.contains(id))
    }) {
        return invalid(
            "An import plan must not replace an existing folder environment".to_string(),
        );
    }

    Ok(())
}

fn display_importer_name(importer: &str) -> &str {
    importer.strip_prefix("@yaak/importer-").unwrap_or(importer)
}

fn workspace_fields_not_imported(source: &Workspace, destination: &Workspace) -> Vec<&'static str> {
    let mut fields = Vec::new();
    if source.name != destination.name {
        fields.push("workspace name");
    }
    if source.description != destination.description {
        fields.push("description");
    }
    if source.authentication != destination.authentication
        || source.authentication_type != destination.authentication_type
    {
        fields.push("authentication");
    }
    if source.headers != destination.headers {
        fields.push("default headers");
    }
    if source.encryption_key_challenge != destination.encryption_key_challenge {
        fields.push("encryption configuration");
    }
    if source.setting_validate_certificates != destination.setting_validate_certificates {
        fields.push("certificate validation");
    }
    if source.setting_follow_redirects != destination.setting_follow_redirects {
        fields.push("redirect behavior");
    }
    if source.setting_request_timeout != destination.setting_request_timeout {
        fields.push("request timeout");
    }
    if source.setting_request_message_size != destination.setting_request_message_size {
        fields.push("request message size");
    }
    if source.setting_dns_overrides != destination.setting_dns_overrides {
        fields.push("DNS overrides");
    }
    if source.setting_send_cookies != destination.setting_send_cookies
        || source.setting_store_cookies != destination.setting_store_cookies
    {
        fields.push("cookie behavior");
    }
    fields
}

fn display_list(items: &BTreeSet<&str>) -> String {
    let items = items.iter().copied().collect::<Vec<_>>();
    match items.as_slice() {
        [] => String::new(),
        [item] => (*item).to_string(),
        [first, second] => format!("{first} and {second}"),
        _ => format!("{}, and {}", items[..items.len() - 1].join(", "), items[items.len() - 1]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use yaak_models::models::{EnvironmentVariable, HttpRequestHeader};

    fn destination_workspace() -> Workspace {
        Workspace {
            id: "wk_destination".to_string(),
            model: "workspace".to_string(),
            name: "Destination".to_string(),
            authentication: BTreeMap::from([("token".to_string(), json!("keep-me"))]),
            authentication_type: Some("bearer".to_string()),
            headers: vec![HttpRequestHeader {
                enabled: true,
                name: "X-Destination".to_string(),
                value: "preserved".to_string(),
                id: None,
            }],
            setting_validate_certificates: false,
            setting_follow_redirects: false,
            setting_request_timeout: 1234,
            ..Default::default()
        }
    }

    fn imported_resources() -> ImportResources {
        ImportResources {
            workspaces: vec![Workspace {
                id: "wk_source".to_string(),
                model: "workspace".to_string(),
                name: "Imported".to_string(),
                authentication_type: Some("basic".to_string()),
                setting_validate_certificates: true,
                ..Default::default()
            }],
            environments: vec![Environment {
                id: "ev_source_base".to_string(),
                model: "environment".to_string(),
                workspace_id: "wk_source".to_string(),
                name: "Global Variables".to_string(),
                parent_model: "workspace".to_string(),
                variables: vec![EnvironmentVariable {
                    enabled: true,
                    name: "imported".to_string(),
                    value: "yes".to_string(),
                    id: None,
                }],
                ..Default::default()
            }],
            folders: vec![Folder {
                id: "fl_source".to_string(),
                model: "folder".to_string(),
                workspace_id: "wk_source".to_string(),
                name: "Imported Folder".to_string(),
                ..Default::default()
            }],
            http_requests: vec![
                HttpRequest {
                    id: "rq_root".to_string(),
                    model: "http_request".to_string(),
                    workspace_id: "wk_source".to_string(),
                    name: "Root Request".to_string(),
                    method: "GET".to_string(),
                    url: "https://example.com/root".to_string(),
                    ..Default::default()
                },
                HttpRequest {
                    id: "rq_nested".to_string(),
                    model: "http_request".to_string(),
                    workspace_id: "wk_source".to_string(),
                    folder_id: Some("fl_source".to_string()),
                    name: "Nested Request".to_string(),
                    method: "GET".to_string(),
                    url: "https://example.com/nested".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn current_workspace_plan_does_not_mutate_and_preserves_workspace_settings() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let mut destination = destination_workspace();
        let selected_folder = Folder {
            id: "fl_selected".to_string(),
            model: "folder".to_string(),
            workspace_id: destination.id.clone(),
            name: "Selected Folder".to_string(),
            ..Default::default()
        };
        {
            let db = query_manager.connect();
            destination = db
                .upsert_workspace(&destination, &UpdateSource::Import)
                .expect("create destination");
            db.upsert_folder(&selected_folder, &UpdateSource::Import)
                .expect("create selected folder");
            db.upsert_environment(
                &Environment {
                    id: "ev_destination_base".to_string(),
                    model: "environment".to_string(),
                    workspace_id: destination.id.clone(),
                    name: "Destination Variables".to_string(),
                    parent_model: "workspace".to_string(),
                    variables: vec![EnvironmentVariable {
                        enabled: true,
                        name: "destination".to_string(),
                        value: "keep".to_string(),
                        id: None,
                    }],
                    ..Default::default()
                },
                &UpdateSource::Import,
            )
            .expect("create base environment");
        }

        let plan = plan_import_resources(
            &query_manager,
            "OpenAPI".to_string(),
            ImportDestination::CurrentWorkspace {
                workspace_id: destination.id.clone(),
                folder_id: Some(selected_folder.id.clone()),
            },
            imported_resources(),
        )
        .expect("plan import");

        // Planning performed only reads.
        {
            let db = query_manager.connect();
            assert_eq!(db.list_workspaces().expect("list workspaces").len(), 1);
            assert_eq!(db.list_folders(&destination.id).expect("list folders").len(), 1);
            assert!(db.list_http_requests(&destination.id).expect("list requests").is_empty());
            assert_eq!(
                db.list_environments_ensure_base(&destination.id).expect("list environments").len(),
                1
            );
            assert_eq!(db.get_workspace(&destination.id).expect("get destination"), destination);
        }

        assert!(plan.resources.workspaces.is_empty());
        assert_eq!(plan.resources.folders[0].resource.workspace_id, destination.id);
        assert_eq!(
            plan.resources.folders[0].resource.folder_id.as_deref(),
            Some(selected_folder.id.as_str())
        );
        let root_request = plan
            .resources
            .http_requests
            .iter()
            .find(|v| v.resource.name == "Root Request")
            .expect("root request");
        assert_eq!(root_request.resource.folder_id.as_deref(), Some(selected_folder.id.as_str()));
        let nested_request = plan
            .resources
            .http_requests
            .iter()
            .find(|v| v.resource.name == "Nested Request")
            .expect("nested request");
        assert_eq!(
            nested_request.resource.folder_id,
            Some(plan.resources.folders[0].resource.id.clone())
        );
        assert_eq!(plan.resources.environments[0].resource.parent_model, "environment");
        assert!(plan.resources.environments[0].resource.name.ends_with("(Imported)"));
        assert_eq!(plan.warnings.len(), 2);
        assert!(plan.warnings.iter().any(|warning| {
            warning.title == "Workspace settings skipped"
                && warning.detail.starts_with("Imported ·")
                && warning.detail.contains("authentication")
                && warning.detail.contains("default headers")
        }));
        assert!(plan.warnings.iter().any(|warning| {
            warning.title == "Base environment kept separate"
                && warning.detail == "Global Variables → Global Variables (Imported) · 1 variable"
        }));

        let committed = commit_import_plan(&query_manager, plan).expect("commit import");
        assert!(committed.workspaces.is_empty());
        assert_eq!(committed.http_requests.len(), 2);
        assert_eq!(
            query_manager
                .connect()
                .get_workspace(&destination.id)
                .expect("get destination after commit"),
            destination
        );
    }

    #[test]
    fn environment_collisions_are_explicit_and_do_not_overwrite() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let mut resources = imported_resources();
        resources.environments.extend([
            Environment {
                id: "ev_second_base".to_string(),
                model: "environment".to_string(),
                workspace_id: "wk_source".to_string(),
                name: "Second Base".to_string(),
                parent_model: "workspace".to_string(),
                ..Default::default()
            },
            Environment {
                id: "ev_folder_one".to_string(),
                model: "environment".to_string(),
                workspace_id: "wk_source".to_string(),
                name: "Folder One".to_string(),
                parent_model: "folder".to_string(),
                parent_id: Some("fl_source".to_string()),
                ..Default::default()
            },
            Environment {
                id: "ev_folder_two".to_string(),
                model: "environment".to_string(),
                workspace_id: "wk_source".to_string(),
                name: "Folder Two".to_string(),
                parent_model: "folder".to_string(),
                parent_id: Some("fl_source".to_string()),
                ..Default::default()
            },
        ]);

        let plan = plan_import_resources(
            &query_manager,
            "Yaak".to_string(),
            ImportDestination::NewWorkspace,
            resources,
        )
        .expect("plan import");

        assert_eq!(
            plan.resources
                .environments
                .iter()
                .filter(|v| v.resource.parent_model == "workspace")
                .count(),
            1
        );
        assert_eq!(
            plan.resources
                .environments
                .iter()
                .filter(|v| v.resource.parent_model == "folder")
                .count(),
            1
        );
        assert_eq!(plan.warnings.len(), 2);
    }

    #[test]
    fn importer_id_conventions_all_flow_through_the_same_planner() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let destination = destination_workspace();
        query_manager
            .connect()
            .upsert_workspace(&destination, &UpdateSource::Import)
            .expect("create destination");
        let resources = ImportResources {
            workspaces: vec![
                Workspace {
                    id: "GENERATE_ID::WORKSPACE_0".to_string(),
                    model: "workspace".to_string(),
                    name: "Generated ID Importer".to_string(),
                    ..Default::default()
                },
                Workspace {
                    id: "wk_exported".to_string(),
                    model: "workspace".to_string(),
                    name: "Stable ID Importer".to_string(),
                    ..Default::default()
                },
            ],
            http_requests: [
                "GENERATE_ID::WORKSPACE_0",
                "wk_exported",
                "CURRENT_WORKSPACE",
            ]
            .into_iter()
            .enumerate()
            .map(|(index, workspace_id)| HttpRequest {
                id: format!("GENERATE_ID::HTTP_REQUEST_{index}"),
                model: "http_request".to_string(),
                workspace_id: workspace_id.to_string(),
                name: format!("Request {index}"),
                method: "GET".to_string(),
                ..Default::default()
            })
            .collect(),
            ..Default::default()
        };

        let plan = plan_import_resources(
            &query_manager,
            "Compatibility".to_string(),
            ImportDestination::CurrentWorkspace {
                workspace_id: destination.id.clone(),
                folder_id: None,
            },
            resources,
        )
        .expect("plan import");

        assert!(plan.resources.workspaces.is_empty());
        assert!(
            plan.resources.http_requests.iter().all(|v| v.resource.workspace_id == destination.id)
        );
        assert_eq!(
            plan.resources
                .http_requests
                .iter()
                .map(|v| v.resource.id.as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            3
        );
    }

    #[test]
    fn commit_rolls_back_every_resource_when_a_late_write_fails() {
        let dir = tempfile::tempdir().expect("create temp directory");
        let db_path = dir.path().join("models.sqlite");
        let blob_path = dir.path().join("blobs.sqlite");
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_standalone(&db_path, &blob_path).expect("initialize database");
        let plan = plan_import_resources(
            &query_manager,
            "OpenAPI".to_string(),
            ImportDestination::NewWorkspace,
            imported_resources(),
        )
        .expect("plan import");
        let workspace_id = plan.resources.workspaces[0].resource.id.clone();
        let environment_id = plan.resources.environments[0].resource.id.clone();

        let connection = rusqlite::Connection::open(&db_path).expect("open test database");
        connection
            .execute_batch(&format!(
                "CREATE TRIGGER fail_import_environment BEFORE INSERT ON environments \
                 WHEN NEW.id = '{environment_id}' BEGIN SELECT RAISE(FAIL, 'forced failure'); END;"
            ))
            .expect("install failure trigger");
        drop(connection);

        assert!(commit_import_plan(&query_manager, plan).is_err());
        let db = query_manager.connect();
        assert!(db.get_workspace(&workspace_id).is_err(), "workspace insert must roll back");
        assert!(db.get_environment(&environment_id).is_err(), "environment must not exist");
    }
}
