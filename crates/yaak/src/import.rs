use crate::Result;
use chrono::Utc;
use log::info;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use yaak_models::client_db::ClientDb;
use yaak_models::models::{
    AnyModel, DEFAULT_REQUEST_MESSAGE_SIZE, Environment, Folder, GrpcRequest, HttpRequest,
    ImportSource, ImportSourceResource, UpsertModelInfo, WebsocketRequest, Workspace,
};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{
    BatchUpsertResult, ImportConflictResolution, ImportDestination, ImportOrigin, ImportPlan,
    ImportPlanAction, ImportPlanItem, ImportPlanWarning, ImportResourceType, UpdateSource,
};
use yaak_plugins::events::{ImportResources, PluginContext};
use yaak_plugins::manager::PluginManager;

pub struct PlanImportDataParams<'a> {
    pub query_manager: &'a QueryManager,
    pub plugin_manager: &'a PluginManager,
    pub plugin_context: &'a PluginContext,
    pub destination: ImportDestination,
    pub contents: &'a str,
    pub origin: Option<ImportOrigin>,
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
        import_result.source_keys,
        params.origin,
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
    source_keys: Option<BTreeMap<String, String>>,
    origin: Option<ImportOrigin>,
) -> Result<ImportPlan> {
    let mut warnings = Vec::new();
    validate_destination(query_manager, &destination)?;

    let plugin_keys = source_keys.unwrap_or_default();
    // Source keys and merge decisions describe the document as the importer produced it, not as
    // this destination reshapes it, so keep the original around.
    let original = resources.clone();

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
                workspaces.push(workspace);
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
                workspaces.push(workspace);
            }

            (workspaces[0].id.clone(), None)
        }
        ImportDestination::ExistingWorkspace { workspace_id, folder_id } => {
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
            folder
        })
        .collect();

    let http_requests = resources
        .http_requests
        .into_iter()
        .map(|mut request| {
            request.id = HttpRequest::generate_id();
            request.workspace_id = resolve_workspace_id(&request.workspace_id);
            request.folder_id = resolve_folder_id(request.folder_id);
            request
        })
        .collect();

    let grpc_requests = resources
        .grpc_requests
        .into_iter()
        .map(|mut request| {
            request.id = GrpcRequest::generate_id();
            request.workspace_id = resolve_workspace_id(&request.workspace_id);
            request.folder_id = resolve_folder_id(request.folder_id);
            request
        })
        .collect();

    let websocket_requests = resources
        .websocket_requests
        .into_iter()
        .map(|mut request| {
            request.id = WebsocketRequest::generate_id();
            request.workspace_id = resolve_workspace_id(&request.workspace_id);
            request.folder_id = resolve_folder_id(request.folder_id);
            request
        })
        .collect();

    let importing_into_existing =
        matches!(destination, ImportDestination::ExistingWorkspace { .. });
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
                ("workspace", _) if importing_into_existing => {
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

            environment
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

    let resources = BatchUpsertResult {
        workspaces,
        environments,
        folders,
        http_requests,
        grpc_requests,
        websocket_requests,
    };

    let mut plan = ImportPlan {
        importer,
        destination,
        source_keys: assign_source_keys(&resources, &original, &plugin_keys),
        resources,
        warnings,
        items: Vec::new(),
        origin,
    };
    merge_with_linked_source(query_manager, &mut plan, &original)?;
    Ok(plan)
}

/// Commit a previously prepared plan in one transaction, applying only its selected items.
pub fn commit_import_plan(
    query_manager: &QueryManager,
    plan: ImportPlan,
) -> Result<BatchUpsertResult> {
    validate_plan(&plan)?;

    info!("Committing staged import from {}", plan.importer);
    query_manager.with_tx(|tx| {
        validate_destination_db(tx, &plan.destination)?;
        commit_plan_in_tx(tx, plan)
    })
}

fn commit_plan_in_tx(db: &ClientDb, plan: ImportPlan) -> Result<BatchUpsertResult> {
    let items: BTreeMap<String, ImportPlanItem> =
        plan.items.iter().map(|item| (item.model_id.clone(), item.clone())).collect();

    // A resource without an item (workspaces, plans from older callers) always applies.
    // A selected keep-local item is an explicit request to revert the local edits.
    let applies = |id: &str| match items.get(id) {
        None => true,
        Some(item) => match item.action {
            ImportPlanAction::Create | ImportPlanAction::Update | ImportPlanAction::KeepLocal => {
                item.selected
            }
            ImportPlanAction::Conflict => {
                item.resolution == Some(ImportConflictResolution::TakeSource)
            }
            ImportPlanAction::Delete | ImportPlanAction::Unchanged => false,
        },
    };

    // A deselected new folder takes its planned descendants with it: nothing can be
    // created inside a folder that will not exist.
    let is_new_folder = |id: &str| items.get(id).is_some_and(|i| i.action == ImportPlanAction::Create);
    let mut missing_folders: BTreeSet<String> = plan
        .resources
        .folders
        .iter()
        .filter(|f| is_new_folder(&f.id) && !applies(&f.id))
        .map(|f| f.id.clone())
        .collect();
    loop {
        let before = missing_folders.len();
        for folder in &plan.resources.folders {
            if let Some(parent_id) = &folder.folder_id
                && missing_folders.contains(parent_id)
            {
                missing_folders.insert(folder.id.clone());
            }
        }
        if missing_folders.len() == before {
            break;
        }
    }

    let folder_available = |folder_id: &Option<String>| match folder_id {
        Some(id) => !missing_folders.contains(id),
        None => true,
    };

    let resources = &plan.resources;
    let upserted = db.batch_upsert(
        resources.workspaces.clone(),
        resources
            .environments
            .iter()
            .filter(|v| applies(&v.id))
            .filter(|v| v.parent_model != "folder" || folder_available(&v.parent_id))
            .cloned()
            .collect(),
        resources
            .folders
            .iter()
            .filter(|v| applies(&v.id) && !missing_folders.contains(&v.id))
            .cloned()
            .collect(),
        resources
            .http_requests
            .iter()
            .filter(|v| applies(&v.id) && folder_available(&v.folder_id))
            .cloned()
            .collect(),
        resources
            .grpc_requests
            .iter()
            .filter(|v| applies(&v.id) && folder_available(&v.folder_id))
            .cloned()
            .collect(),
        resources
            .websocket_requests
            .iter()
            .filter(|v| applies(&v.id) && folder_available(&v.folder_id))
            .cloned()
            .collect(),
        &UpdateSource::Import,
    )?;

    let selected_deletes = plan
        .items
        .iter()
        .filter(|i| i.action == ImportPlanAction::Delete && i.selected)
        .collect::<Vec<_>>();
    // Folders last so their cascade only has to cover what was not deleted explicitly.
    for item in selected_deletes.iter().filter(|i| i.model != ImportResourceType::Folder) {
        delete_existing_model(db, item.model, &item.model_id)?;
    }
    for item in selected_deletes.iter().filter(|i| i.model == ImportResourceType::Folder) {
        delete_existing_model(db, item.model, &item.model_id)?;
    }

    record_import_source(db, &plan, &items, &upserted)?;

    Ok(upserted)
}

/// A folder deletion may have already cascaded over the model, so absent models are skipped.
fn delete_existing_model(db: &ClientDb, resource: ImportResourceType, id: &str) -> Result<()> {
    use ImportResourceType::*;
    let source = &UpdateSource::Import;
    match resource {
        Environment => {
            if db.get_environment(id).is_ok() {
                db.delete_environment_by_id(id, source)?;
            }
        }
        Folder => {
            if db.get_folder(id).is_ok() {
                db.delete_folder_by_id(id, source)?;
            }
        }
        HttpRequest => {
            if db.get_http_request(id).is_ok() {
                db.delete_http_request_by_id(id, source)?;
            }
        }
        GrpcRequest => {
            if db.get_grpc_request(id).is_ok() {
                db.delete_grpc_request_by_id(id, source)?;
            }
        }
        WebsocketRequest => {
            if db.get_websocket_request(id).is_ok() {
                db.delete_websocket_request_by_id(id, source)?;
            }
        }
        // The destination workspace is never a plan item, so there is nothing to delete
        Workspace => {}
    }
    Ok(())
}

/// Link the committed workspace to the import's origin and store a snapshot per resource, so the
/// next import from the same origin can three-way merge instead of duplicating everything.
///
/// Snapshots advance for everything the user decided on this round — applied items and keep-mine
/// conflicts alike — while deselected updates and deletions keep their old snapshot so they are
/// offered again next time.
fn record_import_source(
    db: &ClientDb,
    plan: &ImportPlan,
    items: &BTreeMap<String, ImportPlanItem>,
    upserted: &BatchUpsertResult,
) -> Result<()> {
    let Some(origin) = &plan.origin else {
        return Ok(());
    };

    let workspace_id = match &plan.destination {
        ImportDestination::ExistingWorkspace { workspace_id, .. } => workspace_id.clone(),
        ImportDestination::NewWorkspace => match upserted.workspaces.first() {
            Some(workspace) => workspace.id.clone(),
            None => return Ok(()),
        },
    };

    let existing = db.find_import_source(&workspace_id, &plan.importer, &origin.origin)?;
    let import_source = db.upsert_import_source(
        &ImportSource {
            id: existing.map(|s| s.id).unwrap_or_default(),
            workspace_id,
            importer: plan.importer.clone(),
            origin: origin.origin.clone(),
            origin_label: origin.label.clone(),
            last_imported_at: Utc::now().naive_utc(),
            ..Default::default()
        },
        &UpdateSource::Import,
    )?;

    let mut committed: BTreeMap<&str, String> = BTreeMap::new();
    for v in &upserted.environments {
        committed.insert(&v.id, serde_json::to_string(v)?);
    }
    for v in &upserted.folders {
        committed.insert(&v.id, serde_json::to_string(v)?);
    }
    for v in &upserted.http_requests {
        committed.insert(&v.id, serde_json::to_string(v)?);
    }
    for v in &upserted.grpc_requests {
        committed.insert(&v.id, serde_json::to_string(v)?);
    }
    for v in &upserted.websocket_requests {
        committed.insert(&v.id, serde_json::to_string(v)?);
    }

    let write_row = |model_id: &str, resource: ImportResourceType, incoming: &dyn Fn() -> Result<String>| -> Result<()> {
        let Some(source_key) = plan.source_keys.get(model_id) else {
            return Ok(());
        };
        let snapshot = match committed.get(model_id) {
            Some(json) => json.clone(),
            None => match items.get(model_id).map(|i| i.action) {
                Some(
                    ImportPlanAction::Unchanged
                    | ImportPlanAction::KeepLocal
                    | ImportPlanAction::Conflict,
                ) => incoming()?,
                // A deselected create, update, or delete stays offered next import
                Some(
                    ImportPlanAction::Create
                    | ImportPlanAction::Update
                    | ImportPlanAction::Delete,
                )
                | None => return Ok(()),
            },
        };
        db.upsert_import_source_resource(&ImportSourceResource {
            import_source_id: import_source.id.clone(),
            source_key: source_key.clone(),
            model_type: resource.as_str().to_string(),
            model_id: model_id.to_string(),
            snapshot,
            ..Default::default()
        })?;
        Ok(())
    };

    for v in &plan.resources.environments {
        write_row(&v.id, ImportResourceType::Environment, &|| Ok(serde_json::to_string(v)?))?;
    }
    for v in &plan.resources.folders {
        write_row(&v.id, ImportResourceType::Folder, &|| Ok(serde_json::to_string(v)?))?;
    }
    for v in &plan.resources.http_requests {
        write_row(&v.id, ImportResourceType::HttpRequest, &|| Ok(serde_json::to_string(v)?))?;
    }
    for v in &plan.resources.grpc_requests {
        write_row(&v.id, ImportResourceType::GrpcRequest, &|| Ok(serde_json::to_string(v)?))?;
    }
    for v in &plan.resources.websocket_requests {
        write_row(&v.id, ImportResourceType::WebsocketRequest, &|| Ok(serde_json::to_string(v)?))?;
    }

    let incoming_keys: BTreeSet<&String> = plan.source_keys.values().collect();
    for row in db.list_import_source_resources(&import_source.id)? {
        if incoming_keys.contains(&row.source_key) {
            continue;
        }
        // Keep only rows that back a deletion the user deselected; it will be offered again.
        let keep = match ImportResourceType::from_str(&row.model_type) {
            Some(resource) => {
                items
                    .get(&row.model_id)
                    .is_some_and(|i| i.action == ImportPlanAction::Delete && !i.selected)
                    && existing_model_json(db, resource, &row.model_id)?.is_some()
            }
            None => false,
        };
        if !keep {
            db.delete_import_source_resource(&import_source.id, &row.source_key)?;
        }
    }

    Ok(())
}

/// Rewrite a plan against the destination's linked import source, if it has one: resources whose
/// source key was seen before adopt the existing model's ID, and every resource gets a plan item
/// describing the create / update / delete / conflict decision to preview.
fn merge_with_linked_source(
    query_manager: &QueryManager,
    plan: &mut ImportPlan,
    original: &ImportResources,
) -> Result<()> {
    let db = query_manager.connect();

    let linked = match (&plan.origin, &plan.destination) {
        (Some(origin), ImportDestination::ExistingWorkspace { workspace_id, .. }) => {
            db.find_import_source(workspace_id, &plan.importer, &origin.origin)?
        }
        (None, _) | (Some(_), ImportDestination::NewWorkspace) => None,
    };

    let Some(source) = linked else {
        plan.items = create_only_items(plan);
        return Ok(());
    };

    let workspace_id = source.workspace_id.clone();
    let rows: BTreeMap<String, ImportSourceResource> = db
        .list_import_source_resources(&source.id)?
        .into_iter()
        .map(|row| (row.source_key.clone(), row))
        .collect();

    // Resources whose key maps to a model that still exists adopt that model's ID.
    let mut remap: BTreeMap<String, String> = BTreeMap::new();
    let mut current_models: BTreeMap<String, Value> = BTreeMap::new();
    {
        let mut consider = |planned_id: &str, resource: ImportResourceType| -> Result<()> {
            let Some(key) = plan.source_keys.get(planned_id) else { return Ok(()) };
            let Some(row) = rows.get(key) else { return Ok(()) };
            if ImportResourceType::from_str(&row.model_type) != Some(resource) {
                return Ok(());
            }
            let Some(current) = existing_model_json(&db, resource, &row.model_id)? else {
                return Ok(());
            };
            if current.get("workspaceId").and_then(|v| v.as_str()) != Some(workspace_id.as_str()) {
                return Ok(());
            }
            remap.insert(planned_id.to_string(), row.model_id.clone());
            current_models.insert(row.model_id.clone(), current);
            Ok(())
        };
        for v in &plan.resources.folders {
            consider(&v.id, ImportResourceType::Folder)?;
        }
        for v in &plan.resources.environments {
            consider(&v.id, ImportResourceType::Environment)?;
        }
        for v in &plan.resources.http_requests {
            consider(&v.id, ImportResourceType::HttpRequest)?;
        }
        for v in &plan.resources.grpc_requests {
            consider(&v.id, ImportResourceType::GrpcRequest)?;
        }
        for v in &plan.resources.websocket_requests {
            consider(&v.id, ImportResourceType::WebsocketRequest)?;
        }
    }

    let remap_ref = |id: Option<String>| id.map(|v| remap.get(&v).cloned().unwrap_or(v));
    for v in &mut plan.resources.folders {
        if let Some(existing_id) = remap.get(&v.id) {
            v.id = existing_id.clone();
        }
        v.folder_id = remap_ref(v.folder_id.take());
    }
    for v in &mut plan.resources.environments {
        if let Some(existing_id) = remap.get(&v.id) {
            v.id = existing_id.clone();
        }
        if v.parent_model == "folder" {
            v.parent_id = remap_ref(v.parent_id.take());
        }
    }
    for v in &mut plan.resources.http_requests {
        if let Some(existing_id) = remap.get(&v.id) {
            v.id = existing_id.clone();
        }
        v.folder_id = remap_ref(v.folder_id.take());
    }
    for v in &mut plan.resources.grpc_requests {
        if let Some(existing_id) = remap.get(&v.id) {
            v.id = existing_id.clone();
        }
        v.folder_id = remap_ref(v.folder_id.take());
    }
    for v in &mut plan.resources.websocket_requests {
        if let Some(existing_id) = remap.get(&v.id) {
            v.id = existing_id.clone();
        }
        v.folder_id = remap_ref(v.folder_id.take());
    }
    plan.source_keys = plan
        .source_keys
        .iter()
        .map(|(id, key)| (remap.get(id).cloned().unwrap_or_else(|| id.clone()), key.clone()))
        .collect();

    // A mapped environment that is currently the destination's base environment stays the base
    // environment: it came from this source, so the imported-copy separation does not apply.
    let mut restored_base_names = BTreeSet::new();
    for (i, v) in plan.resources.environments.iter_mut().enumerate() {
        let is_current_base = current_models
            .get(&v.id)
            .and_then(|m| m.get("parentModel"))
            .and_then(|p| p.as_str())
            == Some("workspace");
        if !is_current_base {
            continue;
        }
        if let Some(source) = original.environments.get(i) {
            v.name = source.name.clone();
        }
        v.parent_model = "workspace".to_string();
        v.parent_id = None;
        restored_base_names.insert(v.name.clone());
    }
    if !restored_base_names.is_empty() {
        plan.warnings.retain(|w| {
            !(w.title == "Base environment kept separate"
                && restored_base_names.iter().any(|n| w.detail.starts_with(&format!("{n} →"))))
        });
    }

    let mut items = Vec::new();
    {
        let mut classify = |any: AnyModel,
                            resource: ImportResourceType,
                            parent_id: Option<String>|
         -> Result<()> {
            let planned_id = any.id().to_string();
            let name = any.resolved_name();

            let mapped = plan
                .source_keys
                .get(&planned_id)
                .and_then(|key| rows.get(key))
                .filter(|row| row.model_id == planned_id);
            let Some(row) = mapped else {
                items.push(ImportPlanItem {
                    action: ImportPlanAction::Create,
                    model: resource,
                    model_id: planned_id,
                    name,
                    parent_id,
                    selected: true,
                    resolution: None,
                });
                return Ok(());
            };

            let incoming = comparable(serde_json::to_value(&any)?);
            let current = current_models
                .get(&planned_id)
                .cloned()
                .map(comparable)
                .unwrap_or_default();
            let (source_changed, local_changed) =
                match serde_json::from_str::<Value>(&row.snapshot).ok().map(comparable) {
                    Some(snapshot) => (incoming != snapshot, current != snapshot),
                    // An unreadable snapshot can't prove anything unchanged, so surface a conflict.
                    None => (true, true),
                };

            let (action, selected, resolution) = match (source_changed, local_changed) {
                (false, false) => (ImportPlanAction::Unchanged, false, None),
                (true, false) => (ImportPlanAction::Update, true, None),
                (false, true) => (ImportPlanAction::KeepLocal, false, None),
                (true, true) => (
                    ImportPlanAction::Conflict,
                    true,
                    Some(ImportConflictResolution::KeepMine),
                ),
            };
            items.push(ImportPlanItem {
                action,
                model: resource,
                model_id: planned_id,
                name,
                parent_id,
                selected,
                resolution,
            });
            Ok(())
        };

        for v in &plan.resources.folders {
            classify(AnyModel::Folder(v.clone()), ImportResourceType::Folder, v.folder_id.clone())?;
        }
        for v in &plan.resources.http_requests {
            classify(AnyModel::HttpRequest(v.clone()), ImportResourceType::HttpRequest, v.folder_id.clone())?;
        }
        for v in &plan.resources.grpc_requests {
            classify(AnyModel::GrpcRequest(v.clone()), ImportResourceType::GrpcRequest, v.folder_id.clone())?;
        }
        for v in &plan.resources.websocket_requests {
            classify(AnyModel::WebsocketRequest(v.clone()), ImportResourceType::WebsocketRequest, v.folder_id.clone())?;
        }
        for v in &plan.resources.environments {
            classify(AnyModel::Environment(v.clone()), ImportResourceType::Environment, v.parent_id.clone())?;
        }
    }

    // Mapped models the source no longer has become deletion offers, deselected by default.
    let incoming_keys: BTreeSet<&String> = plan.source_keys.values().collect();
    for (key, row) in &rows {
        if incoming_keys.contains(key) {
            continue;
        }
        let Some(resource) = ImportResourceType::from_str(&row.model_type) else {
            continue;
        };
        let Some(current) = existing_model_json(&db, resource, &row.model_id)? else {
            continue;
        };
        if current.get("workspaceId").and_then(|v| v.as_str()) != Some(workspace_id.as_str()) {
            continue;
        }
        let name = serde_json::from_value::<AnyModel>(current.clone())
            .map(|m| m.resolved_name())
            .unwrap_or_else(|_| "Unknown".to_string());
        let parent_id = current
            .get("folderId")
            .or_else(|| current.get("parentId"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        items.push(ImportPlanItem {
            action: ImportPlanAction::Delete,
            model: resource,
            model_id: row.model_id.clone(),
            name,
            parent_id,
            selected: false,
            resolution: None,
        });
    }

    plan.items = items;
    Ok(())
}

fn create_only_items(plan: &ImportPlan) -> Vec<ImportPlanItem> {
    let mut items = Vec::new();
    let mut push = |any: AnyModel, resource: ImportResourceType, parent_id: Option<String>| {
        items.push(ImportPlanItem {
            action: ImportPlanAction::Create,
            model: resource,
            model_id: any.id().to_string(),
            name: any.resolved_name(),
            parent_id,
            selected: true,
            resolution: None,
        });
    };
    for v in &plan.resources.folders {
        push(AnyModel::Folder(v.clone()), ImportResourceType::Folder, v.folder_id.clone());
    }
    for v in &plan.resources.http_requests {
        push(AnyModel::HttpRequest(v.clone()), ImportResourceType::HttpRequest, v.folder_id.clone());
    }
    for v in &plan.resources.grpc_requests {
        push(AnyModel::GrpcRequest(v.clone()), ImportResourceType::GrpcRequest, v.folder_id.clone());
    }
    for v in &plan.resources.websocket_requests {
        push(AnyModel::WebsocketRequest(v.clone()), ImportResourceType::WebsocketRequest, v.folder_id.clone());
    }
    for v in &plan.resources.environments {
        push(AnyModel::Environment(v.clone()), ImportResourceType::Environment, v.parent_id.clone());
    }
    items
}

/// Strip identity and bookkeeping fields so equality means "same content in the same place".
/// The deprecated environment `base` flag mirrors `parentModel`, which is compared already.
fn comparable(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        for field in ["id", "model", "workspaceId", "createdAt", "updatedAt", "base"] {
            object.remove(field);
        }
    }
    value
}

fn existing_model_json(
    db: &ClientDb,
    resource: ImportResourceType,
    id: &str,
) -> Result<Option<Value>> {
    use ImportResourceType::*;
    let value = match resource {
        Environment => db.get_environment(id).ok().map(|m| serde_json::to_value(&m)),
        Folder => db.get_folder(id).ok().map(|m| serde_json::to_value(&m)),
        HttpRequest => db.get_http_request(id).ok().map(|m| serde_json::to_value(&m)),
        GrpcRequest => db.get_grpc_request(id).ok().map(|m| serde_json::to_value(&m)),
        WebsocketRequest => db.get_websocket_request(id).ok().map(|m| serde_json::to_value(&m)),
        Workspace => None,
    };
    Ok(value.transpose()?)
}

fn validate_destination(
    query_manager: &QueryManager,
    destination: &ImportDestination,
) -> Result<()> {
    let db = query_manager.connect();
    validate_destination_db(&db, destination)
}

fn validate_destination_db(db: &ClientDb<'_>, destination: &ImportDestination) -> Result<()> {
    let ImportDestination::ExistingWorkspace { workspace_id, folder_id } = destination else {
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
        ImportDestination::ExistingWorkspace { workspace_id, .. } => {
            if !plan.resources.workspaces.is_empty() {
                return invalid(
                    "An existing-workspace import plan must not contain workspace updates"
                        .to_string(),
                );
            }

            let all_workspace_ids = plan
                .resources
                .environments
                .iter()
                .map(|v| &v.workspace_id)
                .chain(plan.resources.folders.iter().map(|v| &v.workspace_id))
                .chain(plan.resources.http_requests.iter().map(|v| &v.workspace_id))
                .chain(plan.resources.grpc_requests.iter().map(|v| &v.workspace_id))
                .chain(plan.resources.websocket_requests.iter().map(|v| &v.workspace_id));
            if all_workspace_ids.into_iter().any(|id| id != workspace_id) {
                return invalid(
                    "An existing-workspace import plan contains resources for another workspace"
                        .to_string(),
                );
            }

            // A merging plan may update the base environment it created earlier, which its plan
            // item records; anything else must not replace the destination's base environment.
            let updates_own_base = |id: &str| {
                plan.items
                    .iter()
                    .any(|i| i.model_id == id && i.action != ImportPlanAction::Create)
            };
            if plan
                .resources
                .environments
                .iter()
                .any(|v| v.parent_model == "workspace" && !updates_own_base(&v.id))
            {
                return invalid(
                    "An existing-workspace import plan must not replace the base environment"
                        .to_string(),
                );
            }
        }
        ImportDestination::NewWorkspace => {
            let workspace_ids =
                plan.resources.workspaces.iter().map(|v| v.id.as_str()).collect::<BTreeSet<_>>();
            if workspace_ids.is_empty() {
                return invalid("A new-workspace import plan has no workspace".to_string());
            }
            let all_workspace_ids = plan
                .resources
                .environments
                .iter()
                .map(|v| v.workspace_id.as_str())
                .chain(plan.resources.folders.iter().map(|v| v.workspace_id.as_str()))
                .chain(plan.resources.http_requests.iter().map(|v| v.workspace_id.as_str()))
                .chain(plan.resources.grpc_requests.iter().map(|v| v.workspace_id.as_str()))
                .chain(plan.resources.websocket_requests.iter().map(|v| v.workspace_id.as_str()));
            if all_workspace_ids.into_iter().any(|id| !workspace_ids.contains(id)) {
                return invalid(
                    "A new-workspace import plan contains resources outside its workspaces"
                        .to_string(),
                );
            }

            let mut base_environment_workspaces = BTreeSet::new();
            if plan.resources.environments.iter().any(|v| {
                v.parent_model == "workspace"
                    && !base_environment_workspaces.insert(v.workspace_id.as_str())
            }) {
                return invalid(
                    "A new-workspace import plan contains multiple base environments for one workspace"
                        .to_string(),
                );
            }
        }
    }

    let planned_folder_ids =
        plan.resources.folders.iter().map(|v| v.id.as_str()).collect::<BTreeSet<_>>();
    if plan.resources.environments.iter().any(|v| {
        v.parent_model == "folder"
            && v.parent_id.as_deref().is_none_or(|id| !planned_folder_ids.contains(id))
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

/// Keys are derived from the document as the importer produced it — names, routes, and folder
/// ancestry before any destination re-rooting or renaming — so the same document maps onto the
/// same keys no matter which workspace it is imported into. Collections are positional: planned
/// entry `i` came from original entry `i`.
fn assign_source_keys(
    resources: &BatchUpsertResult,
    original: &ImportResources,
    plugin_keys: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let folder_tree = original
        .folders
        .iter()
        .map(|v| (v.id.clone(), (v.name.clone(), v.folder_id.clone())))
        .collect::<BTreeMap<_, _>>();

    let plugin_key = |source_id: Option<&String>| source_id.and_then(|id| plugin_keys.get(id));

    // (model ID, importer key, key by name, key by name and content)
    let mut candidates: Vec<(&str, Option<&String>, String, String)> = Vec::new();

    for (i, v) in resources.workspaces.iter().enumerate() {
        let source = original.workspaces.get(i);
        let name = source.map(|s| s.name.as_str()).unwrap_or(v.name.as_str());
        let key = fallback_key("workspace", &[], name);
        candidates.push((&v.id, plugin_key(source.map(|s| &s.id)), key.clone(), key));
    }
    for (i, v) in resources.environments.iter().enumerate() {
        let source = original.environments.get(i);
        let name = source.map(|s| s.name.as_str()).unwrap_or(v.name.as_str());
        let parent_id = source.and_then(|s| {
            if s.parent_model == "folder" { s.parent_id.as_deref() } else { None }
        });
        let ancestry = ancestry_path(&folder_tree, parent_id);
        let key = fallback_key("environment", &ancestry, name);
        candidates.push((&v.id, plugin_key(source.map(|s| &s.id)), key.clone(), key));
    }
    for (i, v) in resources.folders.iter().enumerate() {
        let source = original.folders.get(i);
        let name = source.map(|s| s.name.as_str()).unwrap_or(v.name.as_str());
        let ancestry =
            ancestry_path(&folder_tree, source.and_then(|s| s.folder_id.as_deref()));
        let key = fallback_key("folder", &ancestry, name);
        candidates.push((&v.id, plugin_key(source.map(|s| &s.id)), key.clone(), key));
    }
    for (i, v) in resources.http_requests.iter().enumerate() {
        let source = original.http_requests.get(i);
        let s = source.unwrap_or(v);
        let ancestry = ancestry_path(&folder_tree, s.folder_id.as_deref());
        let method = if s.method.is_empty() { "GET" } else { s.method.as_str() };
        let route = format!("{method} {}", s.url);
        let (by_name, by_content) = derived_pair("http_request", &ancestry, &s.name, &route);
        candidates.push((&v.id, plugin_key(source.map(|s| &s.id)), by_name, by_content));
    }
    for (i, v) in resources.grpc_requests.iter().enumerate() {
        let source = original.grpc_requests.get(i);
        let s = source.unwrap_or(v);
        let ancestry = ancestry_path(&folder_tree, s.folder_id.as_deref());
        let service = s.service.clone().unwrap_or_default();
        let method = s.method.clone().unwrap_or_default();
        let route = format!("{} {service}/{method}", s.url);
        let (by_name, by_content) = derived_pair("grpc_request", &ancestry, &s.name, &route);
        candidates.push((&v.id, plugin_key(source.map(|s| &s.id)), by_name, by_content));
    }
    for (i, v) in resources.websocket_requests.iter().enumerate() {
        let source = original.websocket_requests.get(i);
        let s = source.unwrap_or(v);
        let ancestry = ancestry_path(&folder_tree, s.folder_id.as_deref());
        let (by_name, by_content) = derived_pair("websocket_request", &ancestry, &s.name, &s.url);
        candidates.push((&v.id, plugin_key(source.map(|s| &s.id)), by_name, by_content));
    }

    // A name shared by several resources identifies none of them, so every member of the group
    // falls back to its own content. Counting the whole document first keeps that decision
    // independent of the order the resources happen to be listed in.
    let mut shared_names: BTreeMap<&str, usize> = BTreeMap::new();
    for (_, plugin_key, by_name, _) in &candidates {
        if plugin_key.is_none() {
            *shared_names.entry(by_name.as_str()).or_default() += 1;
        }
    }

    let mut keys = BTreeMap::new();
    let mut used = BTreeSet::new();
    for (model_id, plugin_key, by_name, by_content) in &candidates {
        let key = match plugin_key {
            Some(plugin_key) => (*plugin_key).clone(),
            None if shared_names.get(by_name.as_str()).is_some_and(|n| *n > 1) => {
                by_content.clone()
            }
            None => by_name.clone(),
        };

        // A key identifies one model, so a repeat has to be broken apart rather than overwrite.
        // Reaching here means the resources are indistinguishable by name and content alike.
        let mut unique = key.clone();
        let mut attempt = 1;
        while !used.insert(unique.clone()) {
            attempt += 1;
            unique = format!("{key}~{attempt}");
        }

        keys.insert((*model_id).to_string(), unique);
    }

    keys
}

const IDENTITY_SEP: char = '\u{1f}';

/// A resource's key by name, plus the one to use when another resource already took it.
fn derived_pair(model: &str, ancestry: &[String], name: &str, route: &str) -> (String, String) {
    let by_name = if name.is_empty() { route } else { name };
    let by_content = format!("{by_name}{IDENTITY_SEP}{route}");
    (fallback_key(model, ancestry, by_name), fallback_key(model, ancestry, &by_content))
}

/// Stops at the first folder outside the plan, which is the existing folder an import targets.
fn ancestry_path(
    folders: &BTreeMap<String, (String, Option<String>)>,
    folder_id: Option<&str>,
) -> Vec<String> {
    let mut path = Vec::new();
    let mut seen = BTreeSet::new();
    let mut next = folder_id.map(str::to_string);
    while let Some(id) = next {
        if !seen.insert(id.clone()) {
            break;
        }
        let Some((name, parent_id)) = folders.get(&id) else {
            break;
        };
        path.push(name.clone());
        next = parent_id.clone();
    }
    path.reverse();
    path
}

/// Known limitation: this changes when the source document renames or moves the resource, so a
/// re-import sees a rename as a delete plus an add.
fn fallback_key(model: &str, ancestry: &[String], identity: &str) -> String {
    const RECORD: char = '\u{1e}';
    let ancestry = ancestry.join(RECORD.to_string().as_str());
    format!(
        "fb:{:x}",
        md5::compute(format!("{model}{IDENTITY_SEP}{ancestry}{IDENTITY_SEP}{identity}"))
    )
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
    fn existing_workspace_plan_does_not_mutate_and_preserves_workspace_settings() {
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
            ImportDestination::ExistingWorkspace {
                workspace_id: destination.id.clone(),
                folder_id: Some(selected_folder.id.clone()),
            },
            imported_resources(),
            None,
            None,
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
        assert_eq!(plan.resources.folders[0].workspace_id, destination.id);
        assert_eq!(
            plan.resources.folders[0].folder_id.as_deref(),
            Some(selected_folder.id.as_str())
        );
        let root_request = plan
            .resources
            .http_requests
            .iter()
            .find(|v| v.name == "Root Request")
            .expect("root request");
        assert_eq!(root_request.folder_id.as_deref(), Some(selected_folder.id.as_str()));
        let nested_request = plan
            .resources
            .http_requests
            .iter()
            .find(|v| v.name == "Nested Request")
            .expect("nested request");
        assert_eq!(nested_request.folder_id, Some(plan.resources.folders[0].id.clone()));
        assert_eq!(plan.resources.environments[0].parent_model, "environment");
        assert!(plan.resources.environments[0].name.ends_with("(Imported)"));
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
            None,
            None,
        )
        .expect("plan import");

        assert_eq!(
            plan.resources.environments.iter().filter(|v| v.parent_model == "workspace").count(),
            1
        );
        assert_eq!(
            plan.resources.environments.iter().filter(|v| v.parent_model == "folder").count(),
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
            ImportDestination::ExistingWorkspace {
                workspace_id: destination.id.clone(),
                folder_id: None,
            },
            resources,
            None,
            None,
        )
        .expect("plan import");

        assert!(plan.resources.workspaces.is_empty());
        assert!(plan.resources.http_requests.iter().all(|v| v.workspace_id == destination.id));
        assert_eq!(
            plan.resources
                .http_requests
                .iter()
                .map(|v| v.id.as_str())
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
            None,
            Some(linked_origin()),
        )
        .expect("plan import");
        let workspace_id = plan.resources.workspaces[0].id.clone();
        let environment_id = plan.resources.environments[0].id.clone();

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
        assert!(
            db.list_import_sources(&workspace_id).expect("list import sources").is_empty(),
            "import source must roll back"
        );
    }

    fn request_key<'a>(plan: &'a ImportPlan, name: &str) -> &'a str {
        let request = plan
            .resources
            .http_requests
            .iter()
            .find(|v| v.name == name)
            .unwrap_or_else(|| panic!("no planned request named {name}"));
        plan.source_keys.get(&request.id).expect("request has a source key")
    }

    fn plan_with_keys(
        resources: ImportResources,
        source_keys: Option<BTreeMap<String, String>>,
    ) -> ImportPlan {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        plan_import_resources(
            &query_manager,
            "Yaak".to_string(),
            ImportDestination::NewWorkspace,
            resources,
            source_keys,
            None,
        )
        .expect("plan import")
    }

    #[test]
    fn every_planned_model_gets_a_source_key() {
        let plan = plan_with_keys(imported_resources(), None);

        let planned_ids = plan
            .resources
            .workspaces
            .iter()
            .map(|v| v.id.clone())
            .chain(plan.resources.environments.iter().map(|v| v.id.clone()))
            .chain(plan.resources.folders.iter().map(|v| v.id.clone()))
            .chain(plan.resources.http_requests.iter().map(|v| v.id.clone()))
            .collect::<BTreeSet<_>>();

        assert_eq!(plan.source_keys.keys().cloned().collect::<BTreeSet<_>>(), planned_ids);
        assert!(
            plan.source_keys.values().all(|key| key.starts_with("fb:")),
            "an importer that supplied no keys should leave every key derived: {:?}",
            plan.source_keys,
        );
    }

    #[test]
    fn importer_keys_win_over_derived_ones() {
        let source_keys = BTreeMap::from([("rq_nested".to_string(), "op:listPets".to_string())]);
        let plan = plan_with_keys(imported_resources(), Some(source_keys));

        assert_eq!(request_key(&plan, "Nested Request"), "op:listPets");
        assert!(request_key(&plan, "Root Request").starts_with("fb:"));
    }

    #[test]
    fn derived_keys_survive_a_re_parse_that_mints_new_ids() {
        let first = plan_with_keys(imported_resources(), None);

        let mut edited = imported_resources();
        for (i, request) in edited.http_requests.iter_mut().enumerate() {
            request.id = format!("reparsed_{i}");
            request.url = format!("{}?added=1", request.url);
        }
        edited.folders[0].id = "reparsed_folder".to_string();
        edited.http_requests[1].folder_id = Some("reparsed_folder".to_string());
        let second = plan_with_keys(edited, None);

        assert_eq!(request_key(&first, "Root Request"), request_key(&second, "Root Request"));
        assert_eq!(request_key(&first, "Nested Request"), request_key(&second, "Nested Request"));
    }

    #[test]
    fn derived_keys_distinguish_same_named_requests_by_folder() {
        let mut resources = imported_resources();
        resources.http_requests[1].name = resources.http_requests[0].name.clone();
        let plan = plan_with_keys(resources, None);

        let keys = plan.source_keys.values().collect::<BTreeSet<_>>();
        assert_eq!(keys.len(), plan.source_keys.len(), "keys collided: {:?}", plan.source_keys);
    }

    #[test]
    fn duplicate_keys_are_broken_apart_so_none_are_lost() {
        let mut resources = imported_resources();
        resources.http_requests[1].folder_id = None;
        resources.http_requests[1].name = resources.http_requests[0].name.clone();
        resources.http_requests[1].url = resources.http_requests[0].url.clone();
        let plan = plan_with_keys(resources, None);

        assert_eq!(plan.source_keys.len(), 5);
        let keys = plan.source_keys.values().collect::<BTreeSet<_>>();
        assert_eq!(keys.len(), 5, "keys collided: {:?}", plan.source_keys);
        assert!(
            plan.source_keys.values().any(|key| key.ends_with("~2")),
            "the repeat should be suffixed: {:?}",
            plan.source_keys,
        );
    }

    #[test]
    fn same_named_siblings_keep_their_keys_when_the_document_reorders() {
        let build = |swap: bool| {
            let mut resources = imported_resources();
            resources.http_requests[0].name = "Get".to_string();
            resources.http_requests[1].name = "Get".to_string();
            resources.http_requests[0].folder_id = Some("fl_source".to_string());
            resources.http_requests[0].url = "https://example.com/a".to_string();
            resources.http_requests[1].url = "https://example.com/b".to_string();
            if swap {
                resources.http_requests.swap(0, 1);
            }
            let plan = plan_with_keys(resources, None);
            plan.resources
                .http_requests
                .iter()
                .map(|r| (r.url.clone(), plan.source_keys[&r.id].clone()))
                .collect::<BTreeMap<_, _>>()
        };

        // Listing the pair the other way round must not hand each other's key over, or a later
        // re-import would credit one request's edits to the other.
        assert_eq!(build(false), build(true));
    }

    #[test]
    fn derived_keys_are_prefixed_so_importer_keys_stay_distinguishable() {
        let source_keys = BTreeMap::from([("rq_root".to_string(), "op:root".to_string())]);
        let plan = plan_with_keys(imported_resources(), Some(source_keys));

        assert!(!request_key(&plan, "Root Request").starts_with("fb:"));
        assert!(request_key(&plan, "Nested Request").starts_with("fb:"));
    }

    fn linked_origin() -> ImportOrigin {
        ImportOrigin { origin: "/tmp/api.yaml".to_string(), label: "api.yaml".to_string() }
    }

    fn importer_keys() -> BTreeMap<String, String> {
        BTreeMap::from([
            ("ev_source_base".to_string(), "env:base".to_string()),
            ("fl_source".to_string(), "folder:src".to_string()),
            ("rq_root".to_string(), "op:root".to_string()),
            ("rq_nested".to_string(), "op:nested".to_string()),
            ("rq_extra".to_string(), "op:extra".to_string()),
        ])
    }

    fn first_import(query_manager: &QueryManager) -> BatchUpsertResult {
        let plan = plan_import_resources(
            query_manager,
            "OpenAPI".to_string(),
            ImportDestination::NewWorkspace,
            imported_resources(),
            Some(importer_keys()),
            Some(linked_origin()),
        )
        .expect("plan first import");
        commit_import_plan(query_manager, plan).expect("commit first import")
    }

    fn replan(
        query_manager: &QueryManager,
        workspace_id: &str,
        resources: ImportResources,
    ) -> ImportPlan {
        plan_import_resources(
            query_manager,
            "OpenAPI".to_string(),
            ImportDestination::ExistingWorkspace {
                workspace_id: workspace_id.to_string(),
                folder_id: None,
            },
            resources,
            Some(importer_keys()),
            Some(linked_origin()),
        )
        .expect("plan re-import")
    }

    fn item_by_name<'a>(plan: &'a ImportPlan, name: &str) -> &'a ImportPlanItem {
        plan.items
            .iter()
            .find(|i| i.name == name)
            .unwrap_or_else(|| panic!("no plan item named {name}: {:?}", plan.items))
    }

    #[test]
    fn commit_records_the_linked_source_and_snapshots() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let committed = first_import(&query_manager);
        let workspace_id = committed.workspaces[0].id.clone();

        let source = {
            let db = query_manager.connect();
            let source = db
                .find_import_source(&workspace_id, "OpenAPI", "/tmp/api.yaml")
                .expect("query import source")
                .expect("import source recorded");
            assert_eq!(source.origin_label, "api.yaml");

            let rows = db.list_import_source_resources(&source.id).expect("list resource rows");
            assert_eq!(rows.len(), 4, "one row per non-workspace resource: {rows:?}");
            for row in &rows {
                let snapshot: Value = serde_json::from_str(&row.snapshot).expect("parse snapshot");
                let resource = ImportResourceType::from_str(&row.model_type)
                    .expect("row has a known resource type");
                let current = existing_model_json(&db, resource, &row.model_id)
                    .expect("query current model")
                    .expect("row target exists");
                assert_eq!(comparable(snapshot), comparable(current));
            }
            source
        };

        // Re-importing the identical document is a no-op offer: everything unchanged,
        // ancestry re-rooting does not count as a change, and the base environment it
        // created stays the base environment.
        let plan = replan(&query_manager, &workspace_id, imported_resources());
        assert!(
            plan.items.iter().all(|i| i.action == ImportPlanAction::Unchanged),
            "expected all unchanged: {:?}",
            plan.items
        );
        let base = plan
            .resources
            .environments
            .iter()
            .find(|e| e.name == "Global Variables")
            .expect("base environment keeps its original name");
        assert_eq!(base.parent_model, "workspace");
        commit_import_plan(&query_manager, plan).expect("commit re-import");

        let db = query_manager.connect();
        assert_eq!(db.list_http_requests(&workspace_id).expect("list requests").len(), 2);
        assert_eq!(db.list_folders(&workspace_id).expect("list folders").len(), 1);
        assert_eq!(
            db.list_environments_ensure_base(&workspace_id).expect("list environments").len(),
            1
        );
        let rows = db.list_import_source_resources(&source.id).expect("list resource rows");
        assert_eq!(rows.len(), 4, "re-commit replaces rows instead of accumulating");
    }

    #[test]
    fn re_import_merges_source_and_local_changes() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let committed = first_import(&query_manager);
        let workspace_id = committed.workspaces[0].id.clone();
        let root_id = committed
            .http_requests
            .iter()
            .find(|r| r.name == "Root Request")
            .expect("root request")
            .id
            .clone();

        {
            let db = query_manager.connect();
            let nested = db
                .list_http_requests(&workspace_id)
                .expect("list requests")
                .into_iter()
                .find(|r| r.name == "Nested Request")
                .expect("nested request");
            db.upsert_http_request(
                &HttpRequest {
                    url: "https://example.com/nested-local".to_string(),
                    ..nested.clone()
                },
                &UpdateSource::Background,
            )
            .expect("edit nested request locally");
        }

        let mut resources = imported_resources();
        resources.http_requests[0].url = "https://example.com/root-v2".to_string();
        resources.http_requests.push(HttpRequest {
            id: "rq_extra".to_string(),
            model: "http_request".to_string(),
            workspace_id: "wk_source".to_string(),
            name: "Extra Request".to_string(),
            method: "GET".to_string(),
            url: "https://example.com/extra".to_string(),
            ..Default::default()
        });

        let plan = replan(&query_manager, &workspace_id, resources);
        let root = item_by_name(&plan, "Root Request");
        assert_eq!(root.action, ImportPlanAction::Update);
        assert!(root.selected);
        assert_eq!(root.model_id, root_id, "update targets the mapped model");
        let nested = item_by_name(&plan, "Nested Request");
        assert_eq!(nested.action, ImportPlanAction::KeepLocal);
        assert!(!nested.selected);
        let extra = item_by_name(&plan, "Extra Request");
        assert_eq!(extra.action, ImportPlanAction::Create);
        assert!(extra.selected);
        assert_eq!(item_by_name(&plan, "Imported Folder").action, ImportPlanAction::Unchanged);

        commit_import_plan(&query_manager, plan).expect("commit merge");

        let db = query_manager.connect();
        let requests = db.list_http_requests(&workspace_id).expect("list requests");
        assert_eq!(requests.len(), 3);
        assert_eq!(
            requests.iter().find(|r| r.name == "Root Request").expect("root").url,
            "https://example.com/root-v2"
        );
        assert_eq!(
            requests.iter().find(|r| r.name == "Nested Request").expect("nested").url,
            "https://example.com/nested-local"
        );
    }

    #[test]
    fn rename_in_source_updates_the_same_model() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let committed = first_import(&query_manager);
        let workspace_id = committed.workspaces[0].id.clone();
        let root_id = committed
            .http_requests
            .iter()
            .find(|r| r.name == "Root Request")
            .expect("root request")
            .id
            .clone();

        let mut resources = imported_resources();
        resources.http_requests[0].name = "Root Request Renamed".to_string();
        let plan = replan(&query_manager, &workspace_id, resources);
        let renamed = item_by_name(&plan, "Root Request Renamed");
        assert_eq!(renamed.action, ImportPlanAction::Update);
        assert_eq!(renamed.model_id, root_id);

        commit_import_plan(&query_manager, plan).expect("commit rename");
        let requests =
            query_manager.connect().list_http_requests(&workspace_id).expect("list requests");
        assert_eq!(requests.len(), 2, "rename must not duplicate");
        assert!(requests.iter().any(|r| r.id == root_id && r.name == "Root Request Renamed"));
    }

    #[test]
    fn keep_mine_conflicts_advance_and_are_not_offered_again() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let committed = first_import(&query_manager);
        let workspace_id = committed.workspaces[0].id.clone();
        let root_id = committed
            .http_requests
            .iter()
            .find(|r| r.name == "Root Request")
            .expect("root request")
            .id
            .clone();

        {
            let db = query_manager.connect();
            let root = db.get_http_request(&root_id).expect("get root");
            db.upsert_http_request(
                &HttpRequest { url: "https://example.com/root-local".to_string(), ..root },
                &UpdateSource::Background,
            )
            .expect("edit root locally");
        }

        let mut resources = imported_resources();
        resources.http_requests[0].url = "https://example.com/root-v2".to_string();

        let plan = replan(&query_manager, &workspace_id, resources.clone());
        let root = item_by_name(&plan, "Root Request");
        assert_eq!(root.action, ImportPlanAction::Conflict);
        assert_eq!(root.resolution, Some(ImportConflictResolution::KeepMine));
        commit_import_plan(&query_manager, plan).expect("commit keep-mine");

        assert_eq!(
            query_manager.connect().get_http_request(&root_id).expect("get root").url,
            "https://example.com/root-local",
            "keep-mine must not overwrite the local edit"
        );

        // The decision was recorded, so the same source version stops nagging.
        let plan = replan(&query_manager, &workspace_id, resources);
        assert_eq!(item_by_name(&plan, "Root Request").action, ImportPlanAction::KeepLocal);

        // A newer source version conflicts again; taking it overwrites the local edit.
        let mut resources = imported_resources();
        resources.http_requests[0].url = "https://example.com/root-v3".to_string();
        let mut plan = replan(&query_manager, &workspace_id, resources.clone());
        assert_eq!(item_by_name(&plan, "Root Request").action, ImportPlanAction::Conflict);
        for item in plan.items.iter_mut() {
            if item.action == ImportPlanAction::Conflict {
                item.resolution = Some(ImportConflictResolution::TakeSource);
            }
        }
        commit_import_plan(&query_manager, plan).expect("commit take-source");
        assert_eq!(
            query_manager.connect().get_http_request(&root_id).expect("get root").url,
            "https://example.com/root-v3"
        );
        let plan = replan(&query_manager, &workspace_id, resources);
        assert_eq!(item_by_name(&plan, "Root Request").action, ImportPlanAction::Unchanged);
    }

    #[test]
    fn deselected_update_is_offered_again_next_import() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let committed = first_import(&query_manager);
        let workspace_id = committed.workspaces[0].id.clone();

        let mut resources = imported_resources();
        resources.http_requests[0].url = "https://example.com/root-v2".to_string();

        let mut plan = replan(&query_manager, &workspace_id, resources.clone());
        for item in plan.items.iter_mut() {
            if item.action == ImportPlanAction::Update {
                item.selected = false;
            }
        }
        commit_import_plan(&query_manager, plan).expect("commit with deselected update");

        let db = query_manager.connect();
        let root = db
            .list_http_requests(&workspace_id)
            .expect("list requests")
            .into_iter()
            .find(|r| r.name == "Root Request")
            .expect("root request");
        assert_eq!(root.url, "https://example.com/root", "deselected update must not apply");
        drop(db);

        let plan = replan(&query_manager, &workspace_id, resources);
        assert_eq!(item_by_name(&plan, "Root Request").action, ImportPlanAction::Update);
    }

    #[test]
    fn source_removals_are_deselected_offers_until_applied() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let committed = first_import(&query_manager);
        let workspace_id = committed.workspaces[0].id.clone();

        let mut resources = imported_resources();
        resources.http_requests.remove(1);

        let plan = replan(&query_manager, &workspace_id, resources.clone());
        let removal = item_by_name(&plan, "Nested Request");
        assert_eq!(removal.action, ImportPlanAction::Delete);
        assert!(!removal.selected, "deletions default to deselected");
        commit_import_plan(&query_manager, plan).expect("commit with default selection");
        assert_eq!(
            query_manager.connect().list_http_requests(&workspace_id).expect("list").len(),
            2,
            "deselected deletion must not delete"
        );

        let mut plan = replan(&query_manager, &workspace_id, resources.clone());
        assert_eq!(item_by_name(&plan, "Nested Request").action, ImportPlanAction::Delete);
        for item in plan.items.iter_mut() {
            if item.action == ImportPlanAction::Delete {
                item.selected = true;
            }
        }
        commit_import_plan(&query_manager, plan).expect("commit with deletion");
        assert_eq!(
            query_manager.connect().list_http_requests(&workspace_id).expect("list").len(),
            1
        );

        let plan = replan(&query_manager, &workspace_id, resources);
        assert!(
            plan.items.iter().all(|i| i.action != ImportPlanAction::Delete),
            "applied deletion must not be offered again: {:?}",
            plan.items
        );
    }

    #[test]
    fn locally_deleted_mapped_model_plans_as_create() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let committed = first_import(&query_manager);
        let workspace_id = committed.workspaces[0].id.clone();
        let root_id = committed
            .http_requests
            .iter()
            .find(|r| r.name == "Root Request")
            .expect("root request")
            .id
            .clone();

        query_manager
            .connect()
            .delete_http_request_by_id(&root_id, &UpdateSource::Background)
            .expect("delete root locally");

        let plan = replan(&query_manager, &workspace_id, imported_resources());
        let root = item_by_name(&plan, "Root Request");
        assert_eq!(root.action, ImportPlanAction::Create, "no silent resurrection as an update");
        assert_ne!(root.model_id, root_id);

        commit_import_plan(&query_manager, plan).expect("commit re-create");
        assert_eq!(
            query_manager.connect().list_http_requests(&workspace_id).expect("list").len(),
            2
        );
    }

    #[test]
    fn deselecting_a_new_folder_skips_its_descendants() {
        let (query_manager, _blob_manager, _rx) =
            yaak_models::init_in_memory().expect("initialize database");
        let mut plan = plan_import_resources(
            &query_manager,
            "OpenAPI".to_string(),
            ImportDestination::NewWorkspace,
            imported_resources(),
            Some(importer_keys()),
            Some(linked_origin()),
        )
        .expect("plan import");

        assert_eq!(plan.items.len(), 4, "one create item per non-workspace resource");
        assert!(plan.items.iter().all(|i| i.action == ImportPlanAction::Create && i.selected));

        for item in plan.items.iter_mut() {
            if item.model == ImportResourceType::Folder {
                item.selected = false;
            }
        }
        let committed = commit_import_plan(&query_manager, plan).expect("commit import");
        let workspace_id = committed.workspaces[0].id.clone();

        let db = query_manager.connect();
        assert!(db.list_folders(&workspace_id).expect("list folders").is_empty());
        let requests = db.list_http_requests(&workspace_id).expect("list requests");
        assert_eq!(requests.len(), 1, "requests inside the skipped folder are skipped too");
        assert_eq!(requests[0].name, "Root Request");

        let source = db
            .find_import_source(&workspace_id, "OpenAPI", "/tmp/api.yaml")
            .expect("query import source")
            .expect("import source recorded");
        let rows = db.list_import_source_resources(&source.id).expect("list resource rows");
        assert_eq!(rows.len(), 2, "skipped resources must not advance snapshots: {rows:?}");
    }


#[test]
fn desktop_style_json_roundtrip_records_source() {
    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_in_memory().expect("initialize database");
    let plan = plan_import_resources(
        &query_manager,
        "OpenAPI".to_string(),
        ImportDestination::NewWorkspace,
        imported_resources(),
        None,
        Some(linked_origin()),
    )
    .expect("plan import");
    let json = serde_json::to_string(&plan).expect("serialize plan");
    let plan: ImportPlan = serde_json::from_str(&json).expect("deserialize plan");
    let committed = commit_import_plan(&query_manager, plan).expect("commit");
    let workspace_id = committed.workspaces[0].id.clone();
    let source = query_manager
        .connect()
        .find_import_source(&workspace_id, "OpenAPI", "/tmp/api.yaml")
        .expect("query")
        .expect("source recorded after JSON round-trip");
    assert_eq!(source.origin_label, "api.yaml");
}

#[test]
fn selected_keep_local_reverts_the_local_edit() {
    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_in_memory().expect("initialize database");
    let committed = first_import(&query_manager);
    let workspace_id = committed.workspaces[0].id.clone();
    let root_id = committed
        .http_requests
        .iter()
        .find(|r| r.name == "Root Request")
        .expect("root request")
        .id
        .clone();

    {
        let db = query_manager.connect();
        let root = db.get_http_request(&root_id).expect("get root");
        db.upsert_http_request(
            &HttpRequest { url: "https://example.com/root-local".to_string(), ..root },
            &UpdateSource::Background,
        )
        .expect("edit root locally");
    }

    let mut plan = replan(&query_manager, &workspace_id, imported_resources());
    let root = item_by_name(&plan, "Root Request");
    assert_eq!(root.action, ImportPlanAction::KeepLocal);
    assert!(!root.selected, "keep-local defaults to keeping the local edit");
    for item in plan.items.iter_mut() {
        if item.action == ImportPlanAction::KeepLocal {
            item.selected = true;
        }
    }
    commit_import_plan(&query_manager, plan).expect("commit revert");

    assert_eq!(
        query_manager.connect().get_http_request(&root_id).expect("get root").url,
        "https://example.com/root",
        "selected keep-local must revert to the source version"
    );
    let plan = replan(&query_manager, &workspace_id, imported_resources());
    assert_eq!(item_by_name(&plan, "Root Request").action, ImportPlanAction::Unchanged);
}
}
