use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use yaak_http::sender::{HttpSender, ReqwestSender};
use yaak_http::types::{SendableHttpRequest, SendableHttpRequestOptions};
use yaak_models::models::HttpRequest;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::PluginContext;
use yaak_plugins::manager::PluginManager;

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
            vendored_plugin_dir.clone(),
            installed_plugin_dir.clone(),
            node_bin_path.clone(),
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
            use yaak_actions::{
                ActionExecutor, ActionId, ActionParams, ActionResult, ActionTarget, CurrentContext,
            };
            use yaak_actions_builtin::{BuiltinActionDependencies, register_http_actions};

            // Create dependencies
            let deps = BuiltinActionDependencies::new_standalone(
                &db_path,
                &blob_path,
                &app_id,
                vendored_plugin_dir.clone(),
                installed_plugin_dir.clone(),
                node_bin_path.clone(),
            )
            .await
            .expect("Failed to initialize dependencies");

            // Create executor and register actions
            let executor = ActionExecutor::new();
            executor.register_builtin_groups().await.expect("Failed to register groups");
            register_http_actions(&executor, &deps).await.expect("Failed to register HTTP actions");

            // Prepare context
            let context = CurrentContext {
                target: Some(ActionTarget::HttpRequest { id: request_id.clone() }),
                environment_id: cli.environment.clone(),
                workspace_id: None,
                has_window: false,
                can_prompt: false,
            };

            // Prepare params
            let params = ActionParams {
                data: serde_json::json!({
                    "render": true,
                    "follow_redirects": false,
                    "timeout_ms": 30000,
                }),
            };

            // Invoke action
            let action_id = ActionId::builtin("http", "send-request");
            let result = executor.invoke(&action_id, context, params).await.expect("Action failed");

            // Handle result
            match result {
                ActionResult::Success { data, message } => {
                    if let Some(msg) = message {
                        println!("{}", msg);
                    }
                    if let Some(data) = data {
                        println!("{}", serde_json::to_string_pretty(&data).unwrap());
                    }
                }
                ActionResult::RequiresInput { .. } => {
                    eprintln!("Action requires input (not supported in CLI)");
                }
                ActionResult::Cancelled => {
                    eprintln!("Action cancelled");
                }
            }
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
