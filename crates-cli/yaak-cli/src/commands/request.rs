use crate::cli::{RequestArgs, RequestCommands, RequestSchemaType};
use crate::context::CliContext;
use crate::utils::confirm::confirm_delete;
use crate::utils::json::{
    apply_merge_patch, is_json_shorthand, parse_optional_json, parse_required_json, require_id,
    validate_create_id,
};
use crate::utils::schema::append_agent_hints;
use schemars::schema_for;
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::io::Write;
use tokio::sync::mpsc;
use yaak_http::sender::HttpResponseEvent as SenderHttpResponseEvent;
use yaak::send::{SendHttpRequestByIdWithPluginsParams, send_http_request_by_id_with_plugins};
use yaak_models::models::{GrpcRequest, HttpRequest, WebsocketRequest};
use yaak_models::queries::any_request::AnyRequest;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{FormInput, FormInputBase, JsonPrimitive, PluginContext};

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
        RequestCommands::Schema { request_type, pretty } => {
            return match schema(ctx, request_type, pretty).await {
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

async fn schema(ctx: &CliContext, request_type: RequestSchemaType, pretty: bool) -> CommandResult {
    let mut schema = match request_type {
        RequestSchemaType::Http => serde_json::to_value(schema_for!(HttpRequest))
            .map_err(|e| format!("Failed to serialize HTTP request schema: {e}"))?,
        RequestSchemaType::Grpc => serde_json::to_value(schema_for!(GrpcRequest))
            .map_err(|e| format!("Failed to serialize gRPC request schema: {e}"))?,
        RequestSchemaType::Websocket => serde_json::to_value(schema_for!(WebsocketRequest))
            .map_err(|e| format!("Failed to serialize WebSocket request schema: {e}"))?,
    };

    enrich_schema_guidance(&mut schema, request_type);
    append_agent_hints(&mut schema);

    if let Err(error) = merge_auth_schema_from_plugins(ctx, &mut schema).await {
        eprintln!("Warning: Failed to enrich authentication schema from plugins: {error}");
    }

    let output =
        if pretty { serde_json::to_string_pretty(&schema) } else { serde_json::to_string(&schema) }
            .map_err(|e| format!("Failed to format schema JSON: {e}"))?;
    println!("{output}");
    Ok(())
}

fn enrich_schema_guidance(schema: &mut Value, request_type: RequestSchemaType) {
    if !matches!(request_type, RequestSchemaType::Http) {
        return;
    }

    let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) else {
        return;
    };

    if let Some(url_schema) = properties.get_mut("url").and_then(Value::as_object_mut) {
        append_description(
            url_schema,
            "For path segments like `/foo/:id/comments/:commentId`, put concrete values in `urlParameters` using names without `:` (for example `id`, `commentId`).",
        );
    }
}

fn append_description(schema: &mut Map<String, Value>, extra: &str) {
    match schema.get_mut("description") {
        Some(Value::String(existing)) if !existing.trim().is_empty() => {
            if !existing.ends_with(' ') {
                existing.push(' ');
            }
            existing.push_str(extra);
        }
        _ => {
            schema.insert("description".to_string(), Value::String(extra.to_string()));
        }
    }
}

async fn merge_auth_schema_from_plugins(
    ctx: &CliContext,
    schema: &mut Value,
) -> Result<(), String> {
    let plugin_context = PluginContext::new_empty();
    let plugin_manager = ctx.plugin_manager();
    let summaries = plugin_manager
        .get_http_authentication_summaries(&plugin_context)
        .await
        .map_err(|e| e.to_string())?;

    let mut auth_variants = Vec::new();
    for (_, summary) in summaries {
        let config = match plugin_manager
            .get_http_authentication_config(
                &plugin_context,
                &summary.name,
                HashMap::<String, JsonPrimitive>::new(),
                "yaakcli_request_schema",
            )
            .await
        {
            Ok(config) => config,
            Err(error) => {
                eprintln!(
                    "Warning: Failed to load auth config for strategy '{}': {}",
                    summary.name, error
                );
                continue;
            }
        };

        auth_variants.push(auth_variant_schema(&summary.name, &summary.label, &config.args));
    }

    let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) else {
        return Ok(());
    };

    let Some(auth_schema) = properties.get_mut("authentication") else {
        return Ok(());
    };

    if !auth_variants.is_empty() {
        let mut one_of = vec![auth_schema.clone()];
        one_of.extend(auth_variants);
        *auth_schema = json!({ "oneOf": one_of });
    }

    Ok(())
}

fn auth_variant_schema(auth_name: &str, auth_label: &str, args: &[FormInput]) -> Value {
    let mut properties = Map::new();
    let mut required = Vec::new();
    for input in args {
        add_input_schema(input, &mut properties, &mut required);
    }

    let mut schema = json!({
        "title": auth_label,
        "description": format!("Authentication values for strategy '{}'", auth_name),
        "type": "object",
        "properties": properties,
        "additionalProperties": true
    });

    if !required.is_empty() {
        schema["required"] = json!(required);
    }

    schema
}

fn add_input_schema(
    input: &FormInput,
    properties: &mut Map<String, Value>,
    required: &mut Vec<String>,
) {
    match input {
        FormInput::Text(v) => add_base_schema(
            &v.base,
            json!({
                "type": "string",
                "writeOnly": v.password.unwrap_or(false),
            }),
            properties,
            required,
        ),
        FormInput::Editor(v) => add_base_schema(
            &v.base,
            json!({
                "type": "string",
                "x-editorLanguage": v.language.clone(),
            }),
            properties,
            required,
        ),
        FormInput::Select(v) => {
            let options: Vec<Value> =
                v.options.iter().map(|o| Value::String(o.value.clone())).collect();
            add_base_schema(
                &v.base,
                json!({
                    "type": "string",
                    "enum": options,
                }),
                properties,
                required,
            );
        }
        FormInput::Checkbox(v) => {
            add_base_schema(&v.base, json!({ "type": "boolean" }), properties, required);
        }
        FormInput::File(v) => {
            if v.multiple.unwrap_or(false) {
                add_base_schema(
                    &v.base,
                    json!({
                        "type": "array",
                        "items": { "type": "string" },
                    }),
                    properties,
                    required,
                );
            } else {
                add_base_schema(&v.base, json!({ "type": "string" }), properties, required);
            }
        }
        FormInput::HttpRequest(v) => {
            add_base_schema(&v.base, json!({ "type": "string" }), properties, required);
        }
        FormInput::KeyValue(v) => {
            add_base_schema(
                &v.base,
                json!({
                    "type": "object",
                    "additionalProperties": true,
                }),
                properties,
                required,
            );
        }
        FormInput::Accordion(v) => {
            if let Some(children) = &v.inputs {
                for child in children {
                    add_input_schema(child, properties, required);
                }
            }
        }
        FormInput::HStack(v) => {
            if let Some(children) = &v.inputs {
                for child in children {
                    add_input_schema(child, properties, required);
                }
            }
        }
        FormInput::Banner(v) => {
            if let Some(children) = &v.inputs {
                for child in children {
                    add_input_schema(child, properties, required);
                }
            }
        }
        FormInput::Markdown(_) => {}
    }
}

fn add_base_schema(
    base: &FormInputBase,
    mut schema: Value,
    properties: &mut Map<String, Value>,
    required: &mut Vec<String>,
) {
    if base.hidden.unwrap_or(false) || base.name.trim().is_empty() {
        return;
    }

    if let Some(description) = &base.description {
        schema["description"] = Value::String(description.clone());
    }
    if let Some(label) = &base.label {
        schema["title"] = Value::String(label.clone());
    }
    if let Some(default_value) = &base.default_value {
        schema["default"] = Value::String(default_value.clone());
    }

    let name = base.name.clone();
    properties.insert(name.clone(), schema);
    if !base.optional.unwrap_or(false) {
        required.push(name);
    }
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
    let request =
        ctx.db().get_http_request(request_id).map_err(|e| format!("Failed to get request: {e}"))?;
    let output = serde_json::to_string_pretty(&request)
        .map_err(|e| format!("Failed to serialize request: {e}"))?;
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
        ctx.db().get_any_request(request_id).map_err(|e| format!("Failed to get request: {e}"))?;
    match request {
        AnyRequest::HttpRequest(http_request) => {
            send_http_request_by_id(
                ctx,
                &http_request.id,
                &http_request.workspace_id,
                environment,
                verbose,
            )
            .await
        }
        AnyRequest::GrpcRequest(_) => {
            Err("gRPC request send is not implemented yet in yaak-cli".to_string())
        }
        AnyRequest::WebsocketRequest(_) => {
            Err("WebSocket request send is not implemented yet in yaak-cli".to_string())
        }
    }
}

async fn send_http_request_by_id(
    ctx: &CliContext,
    request_id: &str,
    workspace_id: &str,
    environment: Option<&str>,
    verbose: bool,
) -> Result<(), String> {
    let plugin_context = PluginContext::new(None, Some(workspace_id.to_string()));

    let (event_tx, mut event_rx) = mpsc::channel::<SenderHttpResponseEvent>(100);
    let (body_chunk_tx, mut body_chunk_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let event_handle = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if verbose && !matches!(event, SenderHttpResponseEvent::ChunkReceived { .. }) {
                println!("{}", event);
            }
        }
    });
    let body_handle = tokio::task::spawn_blocking(move || {
        let mut stdout = std::io::stdout();
        while let Some(chunk) = body_chunk_rx.blocking_recv() {
            if stdout.write_all(&chunk).is_err() {
                break;
            }
            let _ = stdout.flush();
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
        emit_response_body_chunks_to: Some(body_chunk_tx),
        plugin_manager: ctx.plugin_manager(),
        encryption_manager: ctx.encryption_manager.clone(),
        plugin_context: &plugin_context,
        cancelled_rx: None,
        connection_manager: None,
    })
    .await;

    let _ = event_handle.await;
    let _ = body_handle.await;
    result.map_err(|e| e.to_string())?;
    Ok(())
}
