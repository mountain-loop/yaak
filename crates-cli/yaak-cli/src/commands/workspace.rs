use crate::cli::{WorkspaceArgs, WorkspaceCommands};
use crate::commands::confirm::confirm_delete;
use crate::context::CliContext;
use yaak_models::models::Workspace;
use yaak_models::util::UpdateSource;

pub fn run(ctx: &CliContext, args: WorkspaceArgs) {
    match args.command {
        WorkspaceCommands::List => list(ctx),
        WorkspaceCommands::Show { workspace_id } => show(ctx, &workspace_id),
        WorkspaceCommands::Create { name } => create(ctx, name),
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

fn create(ctx: &CliContext, name: String) {
    let workspace = Workspace { name, ..Default::default() };
    let created = ctx
        .db()
        .upsert_workspace(&workspace, &UpdateSource::Sync)
        .expect("Failed to create workspace");
    println!("Created workspace: {}", created.id);
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
