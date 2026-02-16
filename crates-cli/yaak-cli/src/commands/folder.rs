use crate::cli::{FolderArgs, FolderCommands};
use crate::commands::confirm::confirm_delete;
use crate::commands::json::{
    apply_merge_patch, is_json_shorthand, parse_optional_json, parse_required_json, require_id,
    validate_create_id,
};
use crate::context::CliContext;
use yaak_models::models::Folder;
use yaak_models::util::UpdateSource;

pub fn run(ctx: &CliContext, args: FolderArgs) {
    match args.command {
        FolderCommands::List { workspace_id } => list(ctx, &workspace_id),
        FolderCommands::Show { folder_id } => show(ctx, &folder_id),
        FolderCommands::Create { workspace_id, name, json } => {
            create(ctx, workspace_id, name, json)
        }
        FolderCommands::Update { json, json_input } => update(ctx, json, json_input),
        FolderCommands::Delete { folder_id, yes } => delete(ctx, &folder_id, yes),
    }
}

fn list(ctx: &CliContext, workspace_id: &str) {
    let folders = ctx.db().list_folders(workspace_id).expect("Failed to list folders");
    if folders.is_empty() {
        println!("No folders found in workspace {}", workspace_id);
    } else {
        for folder in folders {
            println!("{} - {}", folder.id, folder.name);
        }
    }
}

fn show(ctx: &CliContext, folder_id: &str) {
    let folder = ctx.db().get_folder(folder_id).expect("Failed to get folder");
    let output = serde_json::to_string_pretty(&folder).expect("Failed to serialize folder");
    println!("{output}");
}

fn create(
    ctx: &CliContext,
    workspace_id: Option<String>,
    name: Option<String>,
    json: Option<String>,
) {
    if json.is_some() && workspace_id.as_deref().is_some_and(|v| !is_json_shorthand(v)) {
        panic!("folder create cannot combine workspace_id with --json payload");
    }

    let payload = parse_optional_json(
        json,
        workspace_id.clone().filter(|v| is_json_shorthand(v)),
        "folder create",
    );

    if let Some(payload) = payload {
        if name.is_some() {
            panic!("folder create cannot combine --name with JSON payload");
        }

        validate_create_id(&payload, "folder");
        let folder: Folder =
            serde_json::from_value(payload).expect("Failed to parse folder create JSON");

        if folder.workspace_id.is_empty() {
            panic!("folder create JSON requires non-empty \"workspaceId\"");
        }

        let created =
            ctx.db().upsert_folder(&folder, &UpdateSource::Sync).expect("Failed to create folder");

        println!("Created folder: {}", created.id);
        return;
    }

    let workspace_id = workspace_id.unwrap_or_else(|| {
        panic!("folder create requires workspace_id unless JSON payload is provided")
    });
    let name = name
        .unwrap_or_else(|| panic!("folder create requires --name unless JSON payload is provided"));

    let folder = Folder { workspace_id, name, ..Default::default() };

    let created =
        ctx.db().upsert_folder(&folder, &UpdateSource::Sync).expect("Failed to create folder");

    println!("Created folder: {}", created.id);
}

fn update(ctx: &CliContext, json: Option<String>, json_input: Option<String>) {
    let patch = parse_required_json(json, json_input, "folder update");
    let id = require_id(&patch, "folder update");

    let existing = ctx.db().get_folder(&id).expect("Failed to get folder for update");
    let updated = apply_merge_patch(&existing, &patch, &id, "folder update");

    let saved =
        ctx.db().upsert_folder(&updated, &UpdateSource::Sync).expect("Failed to update folder");

    println!("Updated folder: {}", saved.id);
}

fn delete(ctx: &CliContext, folder_id: &str, yes: bool) {
    if !yes && !confirm_delete("folder", folder_id) {
        println!("Aborted");
        return;
    }

    let deleted = ctx
        .db()
        .delete_folder_by_id(folder_id, &UpdateSource::Sync)
        .expect("Failed to delete folder");

    println!("Deleted folder: {}", deleted.id);
}
