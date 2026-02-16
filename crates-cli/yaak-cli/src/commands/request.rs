use crate::cli::{RequestArgs, RequestCommands};
use crate::commands::confirm::confirm_delete;
use crate::commands::json::{
    apply_merge_patch, is_json_shorthand, parse_optional_json, parse_required_json, require_id,
    validate_create_id,
};
use crate::context::CliContext;
use tokio::sync::mpsc;
use yaak::send::{SendHttpRequestByIdParams, send_http_request_by_id};
use yaak_http::types::SendableHttpRequestOptions;
use yaak_models::models::HttpRequest;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{PluginContext, RenderPurpose};
use yaak_plugins::template_callback::PluginTemplateCallback;

pub async fn run(
    ctx: &CliContext,
    args: RequestArgs,
    environment: Option<&str>,
    verbose: bool,
) -> i32 {
    match args.command {
        RequestCommands::List { workspace_id } => {
            list(ctx, &workspace_id);
            0
        }
        RequestCommands::Show { request_id } => {
            show(ctx, &request_id);
            0
        }
        RequestCommands::Send { request_id } => {
            match send_request_by_id(ctx, &request_id, environment, verbose).await {
                Ok(()) => 0,
                Err(error) => {
                    eprintln!("Error: {error}");
                    1
                }
            }
        }
        RequestCommands::Create { workspace_id, name, method, url, json } => {
            create(ctx, workspace_id, name, method, url, json);
            0
        }
        RequestCommands::Update { json, json_input } => {
            update(ctx, json, json_input);
            0
        }
        RequestCommands::Delete { request_id, yes } => {
            delete(ctx, &request_id, yes);
            0
        }
    }
}

fn list(ctx: &CliContext, workspace_id: &str) {
    let requests = ctx.db().list_http_requests(workspace_id).expect("Failed to list requests");
    if requests.is_empty() {
        println!("No requests found in workspace {}", workspace_id);
    } else {
        for request in requests {
            println!("{} - {} {}", request.id, request.method, request.name);
        }
    }
}

fn create(
    ctx: &CliContext,
    workspace_id: Option<String>,
    name: Option<String>,
    method: Option<String>,
    url: Option<String>,
    json: Option<String>,
) {
    if json.is_some() && workspace_id.as_deref().is_some_and(|v| !is_json_shorthand(v)) {
        panic!("request create cannot combine workspace_id with --json payload");
    }

    let payload = parse_optional_json(
        json,
        workspace_id.clone().filter(|v| is_json_shorthand(v)),
        "request create",
    );

    if let Some(payload) = payload {
        if name.is_some() || method.is_some() || url.is_some() {
            panic!("request create cannot combine simple flags with JSON payload");
        }

        validate_create_id(&payload, "request");
        let request: HttpRequest =
            serde_json::from_value(payload).expect("Failed to parse request create JSON");

        if request.workspace_id.is_empty() {
            panic!("request create JSON requires non-empty \"workspaceId\"");
        }

        let created = ctx
            .db()
            .upsert_http_request(&request, &UpdateSource::Sync)
            .expect("Failed to create request");

        println!("Created request: {}", created.id);
        return;
    }

    let workspace_id = workspace_id.unwrap_or_else(|| {
        panic!("request create requires workspace_id unless JSON payload is provided")
    });
    let name = name.unwrap_or_else(|| {
        panic!("request create requires --name unless JSON payload is provided")
    });
    let url = url
        .unwrap_or_else(|| panic!("request create requires --url unless JSON payload is provided"));
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
        .expect("Failed to create request");

    println!("Created request: {}", created.id);
}

fn update(ctx: &CliContext, json: Option<String>, json_input: Option<String>) {
    let patch = parse_required_json(json, json_input, "request update");
    let id = require_id(&patch, "request update");

    let existing = ctx.db().get_http_request(&id).expect("Failed to get request for update");
    let updated = apply_merge_patch(&existing, &patch, &id, "request update");

    let saved = ctx
        .db()
        .upsert_http_request(&updated, &UpdateSource::Sync)
        .expect("Failed to update request");

    println!("Updated request: {}", saved.id);
}

fn show(ctx: &CliContext, request_id: &str) {
    let request = ctx.db().get_http_request(request_id).expect("Failed to get request");
    let output = serde_json::to_string_pretty(&request).expect("Failed to serialize request");
    println!("{output}");
}

fn delete(ctx: &CliContext, request_id: &str, yes: bool) {
    if !yes && !confirm_delete("request", request_id) {
        println!("Aborted");
        return;
    }

    let deleted = ctx
        .db()
        .delete_http_request_by_id(request_id, &UpdateSource::Sync)
        .expect("Failed to delete request");
    println!("Deleted request: {}", deleted.id);
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
    let template_callback = PluginTemplateCallback::new(
        ctx.plugin_manager(),
        ctx.encryption_manager.clone(),
        &plugin_context,
        RenderPurpose::Send,
    );

    let (event_tx, mut event_rx) = mpsc::channel(100);
    let event_handle = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if verbose {
                println!("{}", event);
            }
        }
    });
    let response_dir = ctx.data_dir().join("responses");

    let result = send_http_request_by_id(SendHttpRequestByIdParams {
        query_manager: ctx.query_manager(),
        blob_manager: ctx.blob_manager(),
        request_id,
        environment_id: environment,
        template_callback: &template_callback,
        send_options: SendableHttpRequestOptions::default(),
        update_source: UpdateSource::Sync,
        response_dir: &response_dir,
        persist_events: true,
        emit_events_to: Some(event_tx),
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
