use crate::cli::{ExportArgs, ImportArgs};
use crate::context::CliContext;
use crate::utils::workspace::resolve_workspace_id;
use std::fs;
use std::io::ErrorKind;
use yaak::export::{self, ExportDataParams};
use yaak::import;
use yaak_core::WorkspaceContext;
use yaak_models::util::BatchUpsertResult;
use yaak_plugins::events::{ImportResources, PluginContext};

type CommandResult<T = ()> = std::result::Result<T, String>;

pub async fn run_import(ctx: &CliContext, args: ImportArgs) -> i32 {
    match import(ctx, args).await {
        Ok(result) => {
            println!("Imported {}", format_counts(&result));
            0
        }
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

pub fn run_export(ctx: &CliContext, args: ExportArgs) -> i32 {
    match export(ctx, args) {
        Ok(count) => {
            println!("Exported {count} workspace(s)");
            0
        }
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

async fn import(ctx: &CliContext, args: ImportArgs) -> CommandResult<BatchUpsertResult> {
    if let Some(workspace_id) = args.workspace_id.as_deref() {
        ctx.db()
            .get_workspace(workspace_id)
            .map_err(|e| format!("Failed to get workspace '{workspace_id}': {e}"))?;
    }

    let file_contents = read_import_file(&args.file)?;
    let plugin_context = PluginContext::new(None, args.workspace_id.clone());
    let plugin_manager = ctx.plugin_manager();
    let import_result = plugin_manager
        .import_data(&plugin_context, &file_contents)
        .await
        .map_err(|e| format!("Failed to import data: {e}"))?;
    let resources = import_result.resources;
    let workspace_id = args.workspace_id;
    if workspace_id.is_none() && resources_need_current_workspace(&resources) {
        return Err(
            "This import requires a workspace context. Provide --workspace-id <WORKSPACE_ID>."
                .to_string(),
        );
    }
    let workspace_context = WorkspaceContext {
        workspace_id,
        environment_id: None,
        cookie_jar_id: None,
        request_id: None,
    };
    let imported = import::import_resources(ctx.query_manager(), workspace_context, resources)
        .map_err(|e| format!("Failed to import data: {e}"))?;
    Ok(imported)
}

fn export(ctx: &CliContext, args: ExportArgs) -> CommandResult<usize> {
    let workspace_ids = resolve_export_workspace_ids(ctx, args.workspace_ids, args.all)?;
    let workspace_id_refs: Vec<&str> = workspace_ids.iter().map(String::as_str).collect();
    export::export_data(ExportDataParams {
        query_manager: ctx.query_manager(),
        yaak_version: env!("CARGO_PKG_VERSION"),
        export_path: &args.file,
        workspace_ids: workspace_id_refs,
        include_private_environments: args.include_private_environments,
    })
    .map_err(|e| format!("Failed to export data: {e}"))?;

    Ok(workspace_ids.len())
}

fn resolve_export_workspace_ids(
    ctx: &CliContext,
    workspace_ids: Vec<String>,
    all: bool,
) -> CommandResult<Vec<String>> {
    if all {
        let workspaces =
            ctx.db().list_workspaces().map_err(|e| format!("Failed to list workspaces: {e}"))?;
        if workspaces.is_empty() {
            return Err("No workspaces found to export".to_string());
        }
        return Ok(workspaces.into_iter().map(|w| w.id).collect());
    }

    if workspace_ids.is_empty() {
        return resolve_workspace_id(ctx, None, "export").map(|id| vec![id]);
    }

    for workspace_id in &workspace_ids {
        ctx.db()
            .get_workspace(workspace_id)
            .map_err(|e| format!("Failed to get workspace '{workspace_id}': {e}"))?;
    }
    Ok(workspace_ids)
}

fn read_import_file(path: &std::path::Path) -> CommandResult<String> {
    fs::read_to_string(path).map_err(|err| {
        if err.kind() == ErrorKind::InvalidData {
            format!(
                "Import file must be UTF-8 text; binary files are not supported: {}",
                path.display()
            )
        } else {
            format!("Unable to read import file {}: {err}", path.display())
        }
    })
}

fn resources_need_current_workspace(resources: &ImportResources) -> bool {
    resources.workspaces.iter().any(|w| w.id == "CURRENT_WORKSPACE")
        || resources.environments.iter().any(|e| {
            e.workspace_id == "CURRENT_WORKSPACE"
                || e.parent_id.as_deref() == Some("CURRENT_WORKSPACE")
        })
        || resources.folders.iter().any(|f| {
            f.workspace_id == "CURRENT_WORKSPACE"
                || f.folder_id.as_deref() == Some("CURRENT_WORKSPACE")
        })
        || resources.http_requests.iter().any(|r| {
            r.workspace_id == "CURRENT_WORKSPACE"
                || r.folder_id.as_deref() == Some("CURRENT_WORKSPACE")
        })
        || resources.grpc_requests.iter().any(|r| {
            r.workspace_id == "CURRENT_WORKSPACE"
                || r.folder_id.as_deref() == Some("CURRENT_WORKSPACE")
        })
        || resources.websocket_requests.iter().any(|r| {
            r.workspace_id == "CURRENT_WORKSPACE"
                || r.folder_id.as_deref() == Some("CURRENT_WORKSPACE")
        })
}

fn format_counts(result: &BatchUpsertResult) -> String {
    let names = [
        "workspace",
        "environment",
        "folder",
        "HTTP request",
        "gRPC request",
        "WebSocket request",
    ];
    let counts = [
        (result.workspaces.len(), names[0]),
        (result.environments.len(), names[1]),
        (result.folders.len(), names[2]),
        (result.http_requests.len(), names[3]),
        (result.grpc_requests.len(), names[4]),
        (result.websocket_requests.len(), names[5]),
    ];

    let non_zero: Vec<String> = counts
        .into_iter()
        .filter(|(count, _)| *count > 0)
        .map(|(count, name)| format!("{count} {name}{}", if count == 1 { "" } else { "s" }))
        .collect();

    if non_zero.is_empty() { "nothing".to_string() } else { non_zero.join(", ") }
}
