use crate::cli::{EnvironmentArgs, EnvironmentCommands};
use crate::commands::confirm::confirm_delete;
use crate::context::CliContext;
use yaak_models::models::Environment;
use yaak_models::util::UpdateSource;

pub fn run(ctx: &CliContext, args: EnvironmentArgs) {
    match args.command {
        EnvironmentCommands::List { workspace_id } => list(ctx, &workspace_id),
        EnvironmentCommands::Show { environment_id } => show(ctx, &environment_id),
        EnvironmentCommands::Create { workspace_id, name } => create(ctx, workspace_id, name),
        EnvironmentCommands::Delete { environment_id, yes } => delete(ctx, &environment_id, yes),
    }
}

fn list(ctx: &CliContext, workspace_id: &str) {
    let environments =
        ctx.db().list_environments_ensure_base(workspace_id).expect("Failed to list environments");

    if environments.is_empty() {
        println!("No environments found in workspace {}", workspace_id);
    } else {
        for environment in environments {
            println!("{} - {} ({})", environment.id, environment.name, environment.parent_model);
        }
    }
}

fn show(ctx: &CliContext, environment_id: &str) {
    let environment = ctx.db().get_environment(environment_id).expect("Failed to get environment");
    let output =
        serde_json::to_string_pretty(&environment).expect("Failed to serialize environment");
    println!("{output}");
}

fn create(ctx: &CliContext, workspace_id: String, name: String) {
    let environment = Environment {
        workspace_id,
        name,
        parent_model: "environment".to_string(),
        ..Default::default()
    };

    let created = ctx
        .db()
        .upsert_environment(&environment, &UpdateSource::Sync)
        .expect("Failed to create environment");

    println!("Created environment: {}", created.id);
}

fn delete(ctx: &CliContext, environment_id: &str, yes: bool) {
    if !yes && !confirm_delete("environment", environment_id) {
        println!("Aborted");
        return;
    }

    let deleted = ctx
        .db()
        .delete_environment_by_id(environment_id, &UpdateSource::Sync)
        .expect("Failed to delete environment");

    println!("Deleted environment: {}", deleted.id);
}
