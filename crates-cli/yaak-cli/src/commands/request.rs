use crate::cli::{RequestArgs, RequestCommands};
use crate::context::CliContext;
use log::info;
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::{self, IsTerminal, Write};
use tokio::sync::mpsc;
use yaak_http::path_placeholders::apply_path_placeholders;
use yaak_http::sender::{HttpSender, ReqwestSender};
use yaak_http::types::{SendableHttpRequest, SendableHttpRequestOptions};
use yaak_models::models::{Environment, HttpRequest, HttpRequestHeader, HttpUrlParameter};
use yaak_models::render::make_vars_hashmap;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{PluginContext, RenderPurpose};
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderOptions, parse_and_render, render_json_value_raw};

pub async fn run(ctx: &CliContext, args: RequestArgs, environment: Option<&str>, verbose: bool) {
    match args.command {
        RequestCommands::List { workspace_id } => list(ctx, &workspace_id),
        RequestCommands::Show { request_id } => show(ctx, &request_id),
        RequestCommands::Send { request_id } => {
            send_request_by_id(ctx, &request_id, environment, verbose).await;
        }
        RequestCommands::Create { workspace_id, name, method, url } => {
            create(ctx, workspace_id, name, method, url)
        }
        RequestCommands::Delete { request_id, yes } => delete(ctx, &request_id, yes),
    }
}

fn list(ctx: &CliContext, workspace_id: &str) {
    let requests = ctx
        .db()
        .list_http_requests(workspace_id)
        .expect("Failed to list requests");
    if requests.is_empty() {
        println!("No requests found in workspace {}", workspace_id);
    } else {
        for request in requests {
            println!("{} - {} {}", request.id, request.method, request.name);
        }
    }
}

fn create(ctx: &CliContext, workspace_id: String, name: String, method: String, url: String) {
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

fn show(ctx: &CliContext, request_id: &str) {
    let request = ctx
        .db()
        .get_http_request(request_id)
        .expect("Failed to get request");
    let output = serde_json::to_string_pretty(&request).expect("Failed to serialize request");
    println!("{output}");
}

fn delete(ctx: &CliContext, request_id: &str, yes: bool) {
    if !yes && !confirm_delete_request(request_id) {
        println!("Aborted");
        return;
    }

    let deleted = ctx
        .db()
        .delete_http_request_by_id(request_id, &UpdateSource::Sync)
        .expect("Failed to delete request");
    println!("Deleted request: {}", deleted.id);
}

fn confirm_delete_request(request_id: &str) -> bool {
    if !io::stdin().is_terminal() {
        eprintln!("Refusing to delete in non-interactive mode without --yes");
        std::process::exit(1);
    }

    print!("Delete request {request_id}? [y/N]: ");
    io::stdout().flush().expect("Failed to flush stdout");

    let mut input = String::new();
    io::stdin().read_line(&mut input).expect("Failed to read confirmation");

    matches!(input.trim().to_lowercase().as_str(), "y" | "yes")
}

/// Send a request by ID and print response in the same format as legacy `send`.
pub async fn send_request_by_id(
    ctx: &CliContext,
    request_id: &str,
    environment: Option<&str>,
    verbose: bool,
) {
    let request = ctx
        .db()
        .get_http_request(request_id)
        .expect("Failed to get request");

    let environment_chain = ctx
        .db()
        .resolve_environments(
            &request.workspace_id,
            request.folder_id.as_deref(),
            environment,
        )
        .unwrap_or_default();

    let plugin_context = PluginContext::new(None, Some(request.workspace_id.clone()));
    let template_callback = PluginTemplateCallback::new(
        ctx.plugin_manager.clone(),
        ctx.encryption_manager.clone(),
        &plugin_context,
        RenderPurpose::Send,
    );

    let rendered_request = render_http_request(
        &request,
        environment_chain,
        &template_callback,
        &RenderOptions::throw(),
    )
    .await
    .expect("Failed to render request templates");

    if verbose {
        println!("> {} {}", rendered_request.method, rendered_request.url);
    }

    let sendable = SendableHttpRequest::from_http_request(
        &rendered_request,
        SendableHttpRequestOptions::default(),
    )
    .await
    .expect("Failed to build request");

    let (event_tx, mut event_rx) = mpsc::channel(100);

    let verbose_handle = if verbose {
        Some(tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                println!("{}", event);
            }
        }))
    } else {
        tokio::spawn(async move { while event_rx.recv().await.is_some() {} });
        None
    };

    let sender = ReqwestSender::new().expect("Failed to create HTTP client");
    let response = sender.send(sendable, event_tx).await.expect("Failed to send request");

    if let Some(handle) = verbose_handle {
        let _ = handle.await;
    }

    if verbose {
        println!();
    }
    println!(
        "HTTP {} {}",
        response.status,
        response.status_reason.as_deref().unwrap_or("")
    );

    if verbose {
        for (name, value) in &response.headers {
            println!("{}: {}", name, value);
        }
        println!();
    }

    let (body, _stats) = response.text().await.expect("Failed to read response body");
    println!("{}", body);
}

/// Render an HTTP request with template variables and plugin functions.
async fn render_http_request(
    request: &HttpRequest,
    environment_chain: Vec<Environment>,
    callback: &PluginTemplateCallback,
    options: &RenderOptions,
) -> yaak_templates::error::Result<HttpRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut url_parameters = Vec::new();
    for parameter in request.url_parameters.clone() {
        if !parameter.enabled {
            continue;
        }

        url_parameters.push(HttpUrlParameter {
            enabled: parameter.enabled,
            name: parse_and_render(parameter.name.as_str(), vars, callback, options).await?,
            value: parse_and_render(parameter.value.as_str(), vars, callback, options).await?,
            id: parameter.id,
        })
    }

    let mut headers = Vec::new();
    for header in request.headers.clone() {
        if !header.enabled {
            continue;
        }

        headers.push(HttpRequestHeader {
            enabled: header.enabled,
            name: parse_and_render(header.name.as_str(), vars, callback, options).await?,
            value: parse_and_render(header.value.as_str(), vars, callback, options).await?,
            id: header.id,
        })
    }

    let mut body = BTreeMap::new();
    for (key, value) in request.body.clone() {
        body.insert(key, render_json_value_raw(value, vars, callback, options).await?);
    }

    let authentication = {
        let mut disabled = false;
        let mut auth = BTreeMap::new();

        match request.authentication.get("disabled") {
            Some(Value::Bool(true)) => {
                disabled = true;
            }
            Some(Value::String(template)) => {
                disabled = parse_and_render(template.as_str(), vars, callback, options)
                    .await
                    .unwrap_or_default()
                    .is_empty();
                info!(
                    "Rendering authentication.disabled as a template: {disabled} from \"{template}\""
                );
            }
            _ => {}
        }

        if disabled {
            auth.insert("disabled".to_string(), Value::Bool(true));
        } else {
            for (key, value) in request.authentication.clone() {
                if key == "disabled" {
                    auth.insert(key, Value::Bool(false));
                } else {
                    auth.insert(key, render_json_value_raw(value, vars, callback, options).await?);
                }
            }
        }

        auth
    };

    let url = parse_and_render(request.url.clone().as_str(), vars, callback, options).await?;

    let (url, url_parameters) = apply_path_placeholders(&url, &url_parameters);

    Ok(HttpRequest {
        url,
        url_parameters,
        headers,
        body,
        authentication,
        ..request.to_owned()
    })
}
