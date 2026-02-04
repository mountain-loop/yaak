use clap::{Parser, Subcommand};
use log::info;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use yaak_crypto::manager::EncryptionManager;
use yaak_http::path_placeholders::apply_path_placeholders;
use yaak_http::sender::{HttpSender, ReqwestSender};
use yaak_http::types::{SendableHttpRequest, SendableHttpRequestOptions};
use yaak_models::models::{HttpRequest, HttpRequestHeader, HttpUrlParameter};
use yaak_models::render::make_vars_hashmap;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{PluginContext, RenderPurpose};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderOptions, parse_and_render, render_json_value_raw};

#[derive(Parser)]
#[command(name = "yaakcli")]
#[command(about = "Yaak CLI - API client from the command line")]
struct Cli {
    /// Use a custom data directory
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,

    /// Environment ID to use for variable substitution
    #[arg(long, short, global = true)]
    environment: Option<String>,

    /// Enable verbose logging
    #[arg(long, short, global = true)]
    verbose: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List all workspaces
    Workspaces,
    /// List requests in a workspace
    Requests {
        /// Workspace ID
        workspace_id: String,
    },
    /// Send an HTTP request by ID
    Send {
        /// Request ID
        request_id: String,
    },
    /// Send a GET request to a URL
    Get {
        /// URL to request
        url: String,
    },
    /// Create a new HTTP request
    Create {
        /// Workspace ID
        workspace_id: String,
        /// Request name
        #[arg(short, long)]
        name: String,
        /// HTTP method
        #[arg(short, long, default_value = "GET")]
        method: String,
        /// URL
        #[arg(short, long)]
        url: String,
    },
}

/// Render an HTTP request with template variables and plugin functions
async fn render_http_request(
    r: &HttpRequest,
    environment_chain: Vec<yaak_models::models::Environment>,
    cb: &PluginTemplateCallback,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<HttpRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut url_parameters = Vec::new();
    for p in r.url_parameters.clone() {
        if !p.enabled {
            continue;
        }
        url_parameters.push(HttpUrlParameter {
            enabled: p.enabled,
            name: parse_and_render(p.name.as_str(), vars, cb, opt).await?,
            value: parse_and_render(p.value.as_str(), vars, cb, opt).await?,
            id: p.id,
        })
    }

    let mut headers = Vec::new();
    for p in r.headers.clone() {
        if !p.enabled {
            continue;
        }
        headers.push(HttpRequestHeader {
            enabled: p.enabled,
            name: parse_and_render(p.name.as_str(), vars, cb, opt).await?,
            value: parse_and_render(p.value.as_str(), vars, cb, opt).await?,
            id: p.id,
        })
    }

    let mut body = BTreeMap::new();
    for (k, v) in r.body.clone() {
        body.insert(k, render_json_value_raw(v, vars, cb, opt).await?);
    }

    let authentication = {
        let mut disabled = false;
        let mut auth = BTreeMap::new();
        match r.authentication.get("disabled") {
            Some(Value::Bool(true)) => {
                disabled = true;
            }
            Some(Value::String(tmpl)) => {
                disabled = parse_and_render(tmpl.as_str(), vars, cb, opt)
                    .await
                    .unwrap_or_default()
                    .is_empty();
                info!(
                    "Rendering authentication.disabled as a template: {disabled} from \"{tmpl}\""
                );
            }
            _ => {}
        }
        if disabled {
            auth.insert("disabled".to_string(), Value::Bool(true));
        } else {
            for (k, v) in r.authentication.clone() {
                if k == "disabled" {
                    auth.insert(k, Value::Bool(false));
                } else {
                    auth.insert(k, render_json_value_raw(v, vars, cb, opt).await?);
                }
            }
        }
        auth
    };

    let url = parse_and_render(r.url.clone().as_str(), vars, cb, opt).await?;

    // Apply path placeholders (e.g., /users/:id -> /users/123)
    let (url, url_parameters) = apply_path_placeholders(&url, &url_parameters);

    Ok(HttpRequest { url, url_parameters, headers, body, authentication, ..r.to_owned() })
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // Initialize logging
    if cli.verbose {
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    }

    // Use the same app_id for both data directory and keyring
    let app_id = if cfg!(debug_assertions) { "app.yaak.desktop.dev" } else { "app.yaak.desktop" };

    let data_dir = cli.data_dir.unwrap_or_else(|| {
        dirs::data_dir().expect("Could not determine data directory").join(app_id)
    });

    let db_path = data_dir.join("db.sqlite");
    let blob_path = data_dir.join("blobs.sqlite");

    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize database");

    let db = query_manager.connect();

    // Initialize encryption manager for secure() template function
    // Use the same app_id as the Tauri app for keyring access
    let encryption_manager = Arc::new(EncryptionManager::new(query_manager.clone(), app_id));

    // Initialize plugin manager for template functions
    let vendored_plugin_dir = data_dir.join("vendored-plugins");
    let installed_plugin_dir = data_dir.join("installed-plugins");

    // Use system node for CLI (must be in PATH)
    let node_bin_path = PathBuf::from("node");

    // Find the plugin runtime - check YAAK_PLUGIN_RUNTIME env var, then fallback to development path
    let plugin_runtime_main =
        std::env::var("YAAK_PLUGIN_RUNTIME").map(PathBuf::from).unwrap_or_else(|_| {
            // Development fallback: look relative to crate root
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../crates-tauri/yaak-app/vendored/plugin-runtime/index.cjs")
        });

    // Create plugin manager (plugins may not be available in CLI context)
    let plugin_manager = Arc::new(
        PluginManager::new(
            vendored_plugin_dir,
            installed_plugin_dir,
            node_bin_path,
            plugin_runtime_main,
            false,
        )
        .await,
    );

    // Initialize plugins from database
    let plugins = db.list_plugins().unwrap_or_default();
    if !plugins.is_empty() {
        let errors =
            plugin_manager.initialize_all_plugins(plugins, &PluginContext::new_empty()).await;
        for (plugin_dir, error_msg) in errors {
            eprintln!("Warning: Failed to initialize plugin '{}': {}", plugin_dir, error_msg);
        }
    }

    match cli.command {
        Commands::Workspaces => {
            let workspaces = db.list_workspaces().expect("Failed to list workspaces");
            if workspaces.is_empty() {
                println!("No workspaces found");
            } else {
                for ws in workspaces {
                    println!("{} - {}", ws.id, ws.name);
                }
            }
        }
        Commands::Requests { workspace_id } => {
            let requests = db.list_http_requests(&workspace_id).expect("Failed to list requests");
            if requests.is_empty() {
                println!("No requests found in workspace {}", workspace_id);
            } else {
                for req in requests {
                    println!("{} - {} {}", req.id, req.method, req.name);
                }
            }
        }
        Commands::Send { request_id } => {
            let request = db.get_http_request(&request_id).expect("Failed to get request");

            // Resolve environment chain for variable substitution
            let environment_chain = db
                .resolve_environments(
                    &request.workspace_id,
                    request.folder_id.as_deref(),
                    cli.environment.as_deref(),
                )
                .unwrap_or_default();

            // Create template callback with plugin support
            let plugin_context = PluginContext::new(None, Some(request.workspace_id.clone()));
            let template_callback = PluginTemplateCallback::new(
                plugin_manager.clone(),
                encryption_manager.clone(),
                &plugin_context,
                RenderPurpose::Send,
            );

            // Render templates in the request
            let rendered_request = render_http_request(
                &request,
                environment_chain,
                &template_callback,
                &RenderOptions::throw(),
            )
            .await
            .expect("Failed to render request templates");

            if cli.verbose {
                println!("> {} {}", rendered_request.method, rendered_request.url);
            }

            // Convert to sendable request
            let sendable = SendableHttpRequest::from_http_request(
                &rendered_request,
                SendableHttpRequestOptions::default(),
            )
            .await
            .expect("Failed to build request");

            // Create event channel for progress
            let (event_tx, mut event_rx) = mpsc::channel(100);

            // Spawn task to print events if verbose
            let verbose = cli.verbose;
            let verbose_handle = if verbose {
                Some(tokio::spawn(async move {
                    while let Some(event) = event_rx.recv().await {
                        println!("{}", event);
                    }
                }))
            } else {
                // Drain events silently
                tokio::spawn(async move { while event_rx.recv().await.is_some() {} });
                None
            };

            // Send the request
            let sender = ReqwestSender::new().expect("Failed to create HTTP client");
            let response = sender.send(sendable, event_tx).await.expect("Failed to send request");

            // Wait for event handler to finish
            if let Some(handle) = verbose_handle {
                let _ = handle.await;
            }

            // Print response
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

            // Print body
            let (body, _stats) = response.text().await.expect("Failed to read response body");
            println!("{}", body);
        }
        Commands::Get { url } => {
            if cli.verbose {
                println!("> GET {}", url);
            }

            // Build a simple GET request
            let sendable = SendableHttpRequest {
                url: url.clone(),
                method: "GET".to_string(),
                headers: vec![],
                body: None,
                options: SendableHttpRequestOptions::default(),
            };

            // Create event channel for progress
            let (event_tx, mut event_rx) = mpsc::channel(100);

            // Spawn task to print events if verbose
            let verbose = cli.verbose;
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

            // Send the request
            let sender = ReqwestSender::new().expect("Failed to create HTTP client");
            let response = sender.send(sendable, event_tx).await.expect("Failed to send request");

            if let Some(handle) = verbose_handle {
                let _ = handle.await;
            }

            // Print response
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

            // Print body
            let (body, _stats) = response.text().await.expect("Failed to read response body");
            println!("{}", body);
        }
        Commands::Create { workspace_id, name, method, url } => {
            let request = HttpRequest {
                workspace_id,
                name,
                method: method.to_uppercase(),
                url,
                ..Default::default()
            };

            let created = db
                .upsert_http_request(&request, &UpdateSource::Sync)
                .expect("Failed to create request");

            println!("Created request: {}", created.id);
        }
    }

    // Terminate plugin manager gracefully
    plugin_manager.terminate().await;
}
