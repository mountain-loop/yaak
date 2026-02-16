use crate::cli::{WorkspaceArgs, WorkspaceCommands};
use crate::context::CliContext;

pub fn run(ctx: &CliContext, args: WorkspaceArgs) {
    match args.command {
        WorkspaceCommands::List => list(ctx),
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
