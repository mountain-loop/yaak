use crate::cli::{FolderArgs, FolderCommands};
use crate::context::CliContext;
use crate::utils::confirm::confirm_delete;
use crate::utils::json::{
    apply_merge_patch, is_json_shorthand, parse_optional_json, parse_required_json, require_id,
    validate_create_id,
};
use yaak_models::models::Folder;
use yaak_models::util::UpdateSource;

type CommandResult<T = ()> = std::result::Result<T, String>;

pub fn run(ctx: &CliContext, args: FolderArgs) -> i32 {
    let result = match args.command {
        FolderCommands::List { workspace_id } => list(ctx, &workspace_id),
        FolderCommands::Show { folder_id } => show(ctx, &folder_id),
        FolderCommands::Create { workspace_id, name, json } => {
            create(ctx, workspace_id, name, json)
        }
        FolderCommands::Update { json, json_input } => update(ctx, json, json_input),
        FolderCommands::Delete { folder_id, yes } => delete(ctx, &folder_id, yes),
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

fn list(ctx: &CliContext, workspace_id: &str) -> CommandResult {
    let folders = ctx.db().list_folders(workspace_id).map_err(|e| format!("Failed to list folders: {e}"))?;
    if folders.is_empty() {
        println!("No folders found in workspace {}", workspace_id);
    } else {
        for folder in folders {
            println!("{} - {}", folder.id, folder.name);
        }
    }
    Ok(())
}

fn show(ctx: &CliContext, folder_id: &str) -> CommandResult {
    let folder = ctx.db().get_folder(folder_id).map_err(|e| format!("Failed to get folder: {e}"))?;
    let output =
        serde_json::to_string_pretty(&folder).map_err(|e| format!("Failed to serialize folder: {e}"))?;
    println!("{output}");
    Ok(())
}

fn create(
    ctx: &CliContext,
    workspace_id: Option<String>,
    name: Option<String>,
    json: Option<String>,
) -> CommandResult {
    if json.is_some() && workspace_id.as_deref().is_some_and(|v| !is_json_shorthand(v)) {
        return Err("folder create cannot combine workspace_id with --json payload".to_string());
    }

    let payload = parse_optional_json(
        json,
        workspace_id.clone().filter(|v| is_json_shorthand(v)),
        "folder create",
    )?;

    if let Some(payload) = payload {
        if name.is_some() {
            return Err("folder create cannot combine --name with JSON payload".to_string());
        }

        validate_create_id(&payload, "folder")?;
        let folder: Folder =
            serde_json::from_value(payload).map_err(|e| format!("Failed to parse folder create JSON: {e}"))?;

        if folder.workspace_id.is_empty() {
            return Err("folder create JSON requires non-empty \"workspaceId\"".to_string());
        }

        let created = ctx
            .db()
            .upsert_folder(&folder, &UpdateSource::Sync)
            .map_err(|e| format!("Failed to create folder: {e}"))?;

        println!("Created folder: {}", created.id);
        return Ok(());
    }

    let workspace_id = workspace_id
        .ok_or_else(|| "folder create requires workspace_id unless JSON payload is provided".to_string())?;
    let name =
        name.ok_or_else(|| "folder create requires --name unless JSON payload is provided".to_string())?;

    let folder = Folder { workspace_id, name, ..Default::default() };

    let created = ctx
        .db()
        .upsert_folder(&folder, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to create folder: {e}"))?;

    println!("Created folder: {}", created.id);
    Ok(())
}

fn update(ctx: &CliContext, json: Option<String>, json_input: Option<String>) -> CommandResult {
    let patch = parse_required_json(json, json_input, "folder update")?;
    let id = require_id(&patch, "folder update")?;

    let existing = ctx
        .db()
        .get_folder(&id)
        .map_err(|e| format!("Failed to get folder for update: {e}"))?;
    let updated = apply_merge_patch(&existing, &patch, &id, "folder update")?;

    let saved = ctx
        .db()
        .upsert_folder(&updated, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to update folder: {e}"))?;

    println!("Updated folder: {}", saved.id);
    Ok(())
}

fn delete(ctx: &CliContext, folder_id: &str, yes: bool) -> CommandResult {
    if !yes && !confirm_delete("folder", folder_id) {
        println!("Aborted");
        return Ok(());
    }

    let deleted = ctx
        .db()
        .delete_folder_by_id(folder_id, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to delete folder: {e}"))?;

    println!("Deleted folder: {}", deleted.id);
    Ok(())
}
