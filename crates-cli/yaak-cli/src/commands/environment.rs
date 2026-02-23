use crate::cli::{EnvironmentArgs, EnvironmentCommands};
use crate::context::CliContext;
use crate::utils::confirm::confirm_delete;
use crate::utils::json::{
    apply_merge_patch, is_json_shorthand, merge_workspace_id_arg, parse_optional_json,
    parse_required_json, require_id, validate_create_id,
};
use crate::utils::schema::append_agent_hints;
use schemars::schema_for;
use yaak_models::models::Environment;
use yaak_models::util::UpdateSource;

type CommandResult<T = ()> = std::result::Result<T, String>;

pub fn run(ctx: &CliContext, args: EnvironmentArgs) -> i32 {
    let result = match args.command {
        EnvironmentCommands::List { workspace_id } => list(ctx, &workspace_id),
        EnvironmentCommands::Schema { pretty } => schema(pretty),
        EnvironmentCommands::Show { environment_id } => show(ctx, &environment_id),
        EnvironmentCommands::Create { workspace_id, name, json } => {
            create(ctx, workspace_id, name, json)
        }
        EnvironmentCommands::Update { json, json_input } => update(ctx, json, json_input),
        EnvironmentCommands::Delete { environment_id, yes } => delete(ctx, &environment_id, yes),
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

fn schema(pretty: bool) -> CommandResult {
    let mut schema = serde_json::to_value(schema_for!(Environment))
        .map_err(|e| format!("Failed to serialize environment schema: {e}"))?;
    append_agent_hints(&mut schema);

    let output =
        if pretty { serde_json::to_string_pretty(&schema) } else { serde_json::to_string(&schema) }
            .map_err(|e| format!("Failed to format environment schema JSON: {e}"))?;
    println!("{output}");
    Ok(())
}

fn list(ctx: &CliContext, workspace_id: &str) -> CommandResult {
    let environments = ctx
        .db()
        .list_environments_ensure_base(workspace_id)
        .map_err(|e| format!("Failed to list environments: {e}"))?;

    if environments.is_empty() {
        println!("No environments found in workspace {}", workspace_id);
    } else {
        for environment in environments {
            println!("{} - {} ({})", environment.id, environment.name, environment.parent_model);
        }
    }
    Ok(())
}

fn show(ctx: &CliContext, environment_id: &str) -> CommandResult {
    let environment = ctx
        .db()
        .get_environment(environment_id)
        .map_err(|e| format!("Failed to get environment: {e}"))?;
    let output = serde_json::to_string_pretty(&environment)
        .map_err(|e| format!("Failed to serialize environment: {e}"))?;
    println!("{output}");
    Ok(())
}

fn create(
    ctx: &CliContext,
    workspace_id: Option<String>,
    name: Option<String>,
    json: Option<String>,
) -> CommandResult {
    let json_shorthand =
        workspace_id.as_deref().filter(|v| is_json_shorthand(v)).map(str::to_owned);
    let workspace_id_arg = workspace_id.filter(|v| !is_json_shorthand(v));

    let payload = parse_optional_json(json, json_shorthand, "environment create")?;

    if let Some(payload) = payload {
        if name.is_some() {
            return Err("environment create cannot combine --name with JSON payload".to_string());
        }

        validate_create_id(&payload, "environment")?;
        let mut environment: Environment = serde_json::from_value(payload)
            .map_err(|e| format!("Failed to parse environment create JSON: {e}"))?;
        merge_workspace_id_arg(
            workspace_id_arg.as_deref(),
            &mut environment.workspace_id,
            "environment create",
        )?;

        if environment.parent_model.is_empty() {
            environment.parent_model = "environment".to_string();
        }

        let created = ctx
            .db()
            .upsert_environment(&environment, &UpdateSource::Sync)
            .map_err(|e| format!("Failed to create environment: {e}"))?;

        println!("Created environment: {}", created.id);
        return Ok(());
    }

    let workspace_id = workspace_id_arg.ok_or_else(|| {
        "environment create requires workspace_id unless JSON payload is provided".to_string()
    })?;
    let name = name.ok_or_else(|| {
        "environment create requires --name unless JSON payload is provided".to_string()
    })?;

    let environment = Environment {
        workspace_id,
        name,
        parent_model: "environment".to_string(),
        ..Default::default()
    };

    let created = ctx
        .db()
        .upsert_environment(&environment, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to create environment: {e}"))?;

    println!("Created environment: {}", created.id);
    Ok(())
}

fn update(ctx: &CliContext, json: Option<String>, json_input: Option<String>) -> CommandResult {
    let patch = parse_required_json(json, json_input, "environment update")?;
    let id = require_id(&patch, "environment update")?;

    let existing = ctx
        .db()
        .get_environment(&id)
        .map_err(|e| format!("Failed to get environment for update: {e}"))?;
    let updated = apply_merge_patch(&existing, &patch, &id, "environment update")?;

    let saved = ctx
        .db()
        .upsert_environment(&updated, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to update environment: {e}"))?;

    println!("Updated environment: {}", saved.id);
    Ok(())
}

fn delete(ctx: &CliContext, environment_id: &str, yes: bool) -> CommandResult {
    if !yes && !confirm_delete("environment", environment_id) {
        println!("Aborted");
        return Ok(());
    }

    let deleted = ctx
        .db()
        .delete_environment_by_id(environment_id, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to delete environment: {e}"))?;

    println!("Deleted environment: {}", deleted.id);
    Ok(())
}
