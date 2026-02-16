use crate::cli::{FolderArgs, FolderCommands};
use crate::commands::confirm::confirm_delete;
use crate::context::CliContext;
use yaak_models::models::Folder;
use yaak_models::util::UpdateSource;

pub fn run(ctx: &CliContext, args: FolderArgs) {
    match args.command {
        FolderCommands::List { workspace_id } => list(ctx, &workspace_id),
        FolderCommands::Show { folder_id } => show(ctx, &folder_id),
        FolderCommands::Create { workspace_id, name } => create(ctx, workspace_id, name),
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

fn create(ctx: &CliContext, workspace_id: String, name: String) {
    let folder = Folder { workspace_id, name, ..Default::default() };

    let created =
        ctx.db().upsert_folder(&folder, &UpdateSource::Sync).expect("Failed to create folder");

    println!("Created folder: {}", created.id);
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
