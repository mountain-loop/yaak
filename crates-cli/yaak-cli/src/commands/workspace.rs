use crate::cli::{WorkspaceArgs, WorkspaceCommands};
use crate::context::CliContext;
use crate::utils::confirm::confirm_delete;
use crate::utils::json::{
    apply_merge_patch, parse_optional_json, parse_required_json, require_id, validate_create_id,
};
use yaak_models::models::Workspace;
use yaak_models::util::UpdateSource;

pub fn run(ctx: &CliContext, args: WorkspaceArgs) {
    match args.command {
        WorkspaceCommands::List => list(ctx),
        WorkspaceCommands::Show { workspace_id } => show(ctx, &workspace_id),
        WorkspaceCommands::Create { name, json, json_input } => create(ctx, name, json, json_input),
        WorkspaceCommands::Update { json, json_input } => update(ctx, json, json_input),
        WorkspaceCommands::Delete { workspace_id, yes } => delete(ctx, &workspace_id, yes),
    }
}

fn list(ctx: &CliContext) {
    let workspaces = ctx.db().list_workspaces().expect("Failed to list workspaces");
    if workspaces.is_empty() {
        println!("No workspaces found");
    } else {
        for workspace in workspaces {
            println!("{} - {}", workspace.id, workspace.name);
        }
    }
}

fn show(ctx: &CliContext, workspace_id: &str) {
    let workspace = ctx.db().get_workspace(workspace_id).expect("Failed to get workspace");
    let output = serde_json::to_string_pretty(&workspace).expect("Failed to serialize workspace");
    println!("{output}");
}

fn create(
    ctx: &CliContext,
    name: Option<String>,
    json: Option<String>,
    json_input: Option<String>,
) {
    let payload = parse_optional_json(json, json_input, "workspace create");

    if let Some(payload) = payload {
        if name.is_some() {
            panic!("workspace create cannot combine --name with JSON payload");
        }

        validate_create_id(&payload, "workspace");
        let workspace: Workspace =
            serde_json::from_value(payload).expect("Failed to parse workspace create JSON");

        let created = ctx
            .db()
            .upsert_workspace(&workspace, &UpdateSource::Sync)
            .expect("Failed to create workspace");
        println!("Created workspace: {}", created.id);
        return;
    }

    let name = name.unwrap_or_else(|| {
        panic!("workspace create requires --name unless JSON payload is provided")
    });

    let workspace = Workspace { name, ..Default::default() };
    let created = ctx
        .db()
        .upsert_workspace(&workspace, &UpdateSource::Sync)
        .expect("Failed to create workspace");
    println!("Created workspace: {}", created.id);
}

fn update(ctx: &CliContext, json: Option<String>, json_input: Option<String>) {
    let patch = parse_required_json(json, json_input, "workspace update");
    let id = require_id(&patch, "workspace update");

    let existing = ctx.db().get_workspace(&id).expect("Failed to get workspace for update");
    let updated = apply_merge_patch(&existing, &patch, &id, "workspace update");

    let saved = ctx
        .db()
        .upsert_workspace(&updated, &UpdateSource::Sync)
        .expect("Failed to update workspace");

    println!("Updated workspace: {}", saved.id);
}

fn delete(ctx: &CliContext, workspace_id: &str, yes: bool) {
    if !yes && !confirm_delete("workspace", workspace_id) {
        println!("Aborted");
        return;
    }

    let deleted = ctx
        .db()
        .delete_workspace_by_id(workspace_id, &UpdateSource::Sync)
        .expect("Failed to delete workspace");
    println!("Deleted workspace: {}", deleted.id);
}
