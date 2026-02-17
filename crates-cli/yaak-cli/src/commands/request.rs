use crate::cli::{RequestArgs, RequestCommands};
use crate::context::CliContext;
use crate::utils::confirm::confirm_delete;
use crate::utils::json::{
    apply_merge_patch, is_json_shorthand, parse_optional_json, parse_required_json, require_id,
    validate_create_id,
};
use tokio::sync::mpsc;
use yaak::send::{SendHttpRequestByIdWithPluginsParams, send_http_request_by_id_with_plugins};
use yaak_models::models::HttpRequest;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::PluginContext;

type CommandResult<T = ()> = std::result::Result<T, String>;

pub async fn run(
    ctx: &CliContext,
    args: RequestArgs,
    environment: Option<&str>,
    verbose: bool,
) -> i32 {
    let result = match args.command {
        RequestCommands::List { workspace_id } => list(ctx, &workspace_id),
        RequestCommands::Show { request_id } => show(ctx, &request_id),
        RequestCommands::Send { request_id } => {
            return match send_request_by_id(ctx, &request_id, environment, verbose).await {
                Ok(()) => 0,
                Err(error) => {
                    eprintln!("Error: {error}");
                    1
                }
            };
        }
        RequestCommands::Create { workspace_id, name, method, url, json } => {
            create(ctx, workspace_id, name, method, url, json)
        }
        RequestCommands::Update { json, json_input } => update(ctx, json, json_input),
        RequestCommands::Delete { request_id, yes } => delete(ctx, &request_id, yes),
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
    let requests = ctx
        .db()
        .list_http_requests(workspace_id)
        .map_err(|e| format!("Failed to list requests: {e}"))?;
    if requests.is_empty() {
        println!("No requests found in workspace {}", workspace_id);
    } else {
        for request in requests {
            println!("{} - {} {}", request.id, request.method, request.name);
        }
    }
    Ok(())
}

fn create(
    ctx: &CliContext,
    workspace_id: Option<String>,
    name: Option<String>,
    method: Option<String>,
    url: Option<String>,
    json: Option<String>,
) -> CommandResult {
    if json.is_some() && workspace_id.as_deref().is_some_and(|v| !is_json_shorthand(v)) {
        return Err("request create cannot combine workspace_id with --json payload".to_string());
    }

    let payload = parse_optional_json(
        json,
        workspace_id.clone().filter(|v| is_json_shorthand(v)),
        "request create",
    )?;

    if let Some(payload) = payload {
        if name.is_some() || method.is_some() || url.is_some() {
            return Err("request create cannot combine simple flags with JSON payload".to_string());
        }

        validate_create_id(&payload, "request")?;
        let request: HttpRequest = serde_json::from_value(payload)
            .map_err(|e| format!("Failed to parse request create JSON: {e}"))?;

        if request.workspace_id.is_empty() {
            return Err("request create JSON requires non-empty \"workspaceId\"".to_string());
        }

        let created = ctx
            .db()
            .upsert_http_request(&request, &UpdateSource::Sync)
            .map_err(|e| format!("Failed to create request: {e}"))?;

        println!("Created request: {}", created.id);
        return Ok(());
    }

    let workspace_id = workspace_id.ok_or_else(|| {
        "request create requires workspace_id unless JSON payload is provided".to_string()
    })?;
    let name = name.unwrap_or_default();
    let url = url.unwrap_or_default();
    let method = method.unwrap_or_else(|| "GET".to_string());

    let request = HttpRequest {
        workspace_id,
        name,
        method: method.to_uppercase(),
        url,
        ..Default::default()
    };

    let created = ctx
        .db()
        .upsert_http_request(&request, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to create request: {e}"))?;

    println!("Created request: {}", created.id);
    Ok(())
}

fn update(ctx: &CliContext, json: Option<String>, json_input: Option<String>) -> CommandResult {
    let patch = parse_required_json(json, json_input, "request update")?;
    let id = require_id(&patch, "request update")?;

    let existing = ctx
        .db()
        .get_http_request(&id)
        .map_err(|e| format!("Failed to get request for update: {e}"))?;
    let updated = apply_merge_patch(&existing, &patch, &id, "request update")?;

    let saved = ctx
        .db()
        .upsert_http_request(&updated, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to update request: {e}"))?;

    println!("Updated request: {}", saved.id);
    Ok(())
}

fn show(ctx: &CliContext, request_id: &str) -> CommandResult {
    let request = ctx
        .db()
        .get_http_request(request_id)
        .map_err(|e| format!("Failed to get request: {e}"))?;
    let output =
        serde_json::to_string_pretty(&request).map_err(|e| format!("Failed to serialize request: {e}"))?;
    println!("{output}");
    Ok(())
}

fn delete(ctx: &CliContext, request_id: &str, yes: bool) -> CommandResult {
    if !yes && !confirm_delete("request", request_id) {
        println!("Aborted");
        return Ok(());
    }

    let deleted = ctx
        .db()
        .delete_http_request_by_id(request_id, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to delete request: {e}"))?;
    println!("Deleted request: {}", deleted.id);
    Ok(())
}

/// Send a request by ID and print response in the same format as legacy `send`.
pub async fn send_request_by_id(
    ctx: &CliContext,
    request_id: &str,
    environment: Option<&str>,
    verbose: bool,
) -> Result<(), String> {
    let request =
        ctx.db().get_http_request(request_id).map_err(|e| format!("Failed to get request: {e}"))?;

    let plugin_context = PluginContext::new(None, Some(request.workspace_id.clone()));

    let (event_tx, mut event_rx) = mpsc::channel(100);
    let event_handle = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if verbose {
                println!("{}", event);
            }
        }
    });
    let response_dir = ctx.data_dir().join("responses");

    let result = send_http_request_by_id_with_plugins(SendHttpRequestByIdWithPluginsParams {
        query_manager: ctx.query_manager(),
        blob_manager: ctx.blob_manager(),
        request_id,
        environment_id: environment,
        update_source: UpdateSource::Sync,
        cookie_jar_id: None,
        response_dir: &response_dir,
        emit_events_to: Some(event_tx),
        plugin_manager: ctx.plugin_manager(),
        encryption_manager: ctx.encryption_manager.clone(),
        plugin_context: &plugin_context,
        cancelled_rx: None,
        connection_manager: None,
    })
    .await;

    let _ = event_handle.await;
    let result = result.map_err(|e| e.to_string())?;

    if verbose {
        println!();
    }
    println!(
        "HTTP {} {}",
        result.response.status,
        result.response.status_reason.as_deref().unwrap_or("")
    );
    if verbose {
        for header in &result.response.headers {
            println!("{}: {}", header.name, header.value);
        }
        println!();
    }
    let body = String::from_utf8(result.response_body)
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    println!("{}", body);
    Ok(())
}
