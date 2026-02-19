use crate::cli::{WorkspaceArgs, WorkspaceCommands};
use crate::context::CliContext;
use crate::utils::confirm::confirm_delete;
use crate::utils::json::{
    apply_merge_patch, parse_optional_json, parse_required_json, require_id, validate_create_id,
};
use yaak_models::models::Workspace;
use yaak_models::util::UpdateSource;

type CommandResult<T = ()> = std::result::Result<T, String>;

pub fn run(ctx: &CliContext, args: WorkspaceArgs) -> i32 {
    let result = match args.command {
        WorkspaceCommands::List => list(ctx),
        WorkspaceCommands::Show { workspace_id } => show(ctx, &workspace_id),
        WorkspaceCommands::Create { name, json, json_input } => create(ctx, name, json, json_input),
        WorkspaceCommands::Update { json, json_input } => update(ctx, json, json_input),
        WorkspaceCommands::Delete { workspace_id, yes } => delete(ctx, &workspace_id, yes),
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

fn list(ctx: &CliContext) -> CommandResult {
    let workspaces = ctx.db().list_workspaces().map_err(|e| format!("Failed to list workspaces: {e}"))?;
    if workspaces.is_empty() {
        println!("No workspaces found");
    } else {
        for workspace in workspaces {
            println!("{} - {}", workspace.id, workspace.name);
        }
    }
    Ok(())
}

fn show(ctx: &CliContext, workspace_id: &str) -> CommandResult {
    let workspace = ctx
        .db()
        .get_workspace(workspace_id)
        .map_err(|e| format!("Failed to get workspace: {e}"))?;
    let output = serde_json::to_string_pretty(&workspace)
        .map_err(|e| format!("Failed to serialize workspace: {e}"))?;
    println!("{output}");
    Ok(())
}

fn create(
    ctx: &CliContext,
    name: Option<String>,
    json: Option<String>,
    json_input: Option<String>,
) -> CommandResult {
    let payload = parse_optional_json(json, json_input, "workspace create")?;

    if let Some(payload) = payload {
        if name.is_some() {
            return Err("workspace create cannot combine --name with JSON payload".to_string());
        }

        validate_create_id(&payload, "workspace")?;
        let workspace: Workspace = serde_json::from_value(payload)
            .map_err(|e| format!("Failed to parse workspace create JSON: {e}"))?;

        let created = ctx
            .db()
            .upsert_workspace(&workspace, &UpdateSource::Sync)
            .map_err(|e| format!("Failed to create workspace: {e}"))?;
        println!("Created workspace: {}", created.id);
        return Ok(());
    }

    let name =
        name.ok_or_else(|| "workspace create requires --name unless JSON payload is provided".to_string())?;

    let workspace = Workspace { name, ..Default::default() };
    let created = ctx
        .db()
        .upsert_workspace(&workspace, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to create workspace: {e}"))?;
    println!("Created workspace: {}", created.id);
    Ok(())
}

fn update(ctx: &CliContext, json: Option<String>, json_input: Option<String>) -> CommandResult {
    let patch = parse_required_json(json, json_input, "workspace update")?;
    let id = require_id(&patch, "workspace update")?;

    let existing = ctx
        .db()
        .get_workspace(&id)
        .map_err(|e| format!("Failed to get workspace for update: {e}"))?;
    let updated = apply_merge_patch(&existing, &patch, &id, "workspace update")?;

    let saved = ctx
        .db()
        .upsert_workspace(&updated, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to update workspace: {e}"))?;

    println!("Updated workspace: {}", saved.id);
    Ok(())
}

fn delete(ctx: &CliContext, workspace_id: &str, yes: bool) -> CommandResult {
    if !yes && !confirm_delete("workspace", workspace_id) {
        println!("Aborted");
        return Ok(());
    }

    let deleted = ctx
        .db()
        .delete_workspace_by_id(workspace_id, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to delete workspace: {e}"))?;
    println!("Deleted workspace: {}", deleted.id);
    Ok(())
}
