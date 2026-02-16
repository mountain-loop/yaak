use crate::cli::{EnvironmentArgs, EnvironmentCommands};
use crate::commands::confirm::confirm_delete;
use crate::commands::json::{
    apply_merge_patch, is_json_shorthand, parse_optional_json, parse_required_json, require_id,
    validate_create_id,
};
use crate::context::CliContext;
use yaak_models::models::Environment;
use yaak_models::util::UpdateSource;

pub fn run(ctx: &CliContext, args: EnvironmentArgs) {
    match args.command {
        EnvironmentCommands::List { workspace_id } => list(ctx, &workspace_id),
        EnvironmentCommands::Show { environment_id } => show(ctx, &environment_id),
        EnvironmentCommands::Create { workspace_id, name, json } => {
            create(ctx, workspace_id, name, json)
        }
        EnvironmentCommands::Update { json, json_input } => update(ctx, json, json_input),
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

fn create(
    ctx: &CliContext,
    workspace_id: Option<String>,
    name: Option<String>,
    json: Option<String>,
) {
    if json.is_some() && workspace_id.as_deref().is_some_and(|v| !is_json_shorthand(v)) {
        panic!("environment create cannot combine workspace_id with --json payload");
    }

    let payload = parse_optional_json(
        json,
        workspace_id.clone().filter(|v| is_json_shorthand(v)),
        "environment create",
    );

    if let Some(payload) = payload {
        if name.is_some() {
            panic!("environment create cannot combine --name with JSON payload");
        }

        validate_create_id(&payload, "environment");
        let mut environment: Environment =
            serde_json::from_value(payload).expect("Failed to parse environment create JSON");

        if environment.workspace_id.is_empty() {
            panic!("environment create JSON requires non-empty \"workspaceId\"");
        }

        if environment.parent_model.is_empty() {
            environment.parent_model = "environment".to_string();
        }

        let created = ctx
            .db()
            .upsert_environment(&environment, &UpdateSource::Sync)
            .expect("Failed to create environment");

        println!("Created environment: {}", created.id);
        return;
    }

    let workspace_id = workspace_id.unwrap_or_else(|| {
        panic!("environment create requires workspace_id unless JSON payload is provided")
    });
    let name = name.unwrap_or_else(|| {
        panic!("environment create requires --name unless JSON payload is provided")
    });

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

fn update(ctx: &CliContext, json: Option<String>, json_input: Option<String>) {
    let patch = parse_required_json(json, json_input, "environment update");
    let id = require_id(&patch, "environment update");

    let existing = ctx.db().get_environment(&id).expect("Failed to get environment for update");
    let updated = apply_merge_patch(&existing, &patch, &id, "environment update");

    let saved = ctx
        .db()
        .upsert_environment(&updated, &UpdateSource::Sync)
        .expect("Failed to update environment");

    println!("Updated environment: {}", saved.id);
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
