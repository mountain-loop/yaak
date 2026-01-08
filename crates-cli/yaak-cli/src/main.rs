use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tokio::sync::mpsc;
use yaak_http::sender::{HttpSender, ReqwestSender};
use yaak_http::types::{SendableHttpRequest, SendableHttpRequestOptions};
use yaak_models::models::HttpRequest;
use yaak_models::util::UpdateSource;

#[derive(Parser)]
#[command(name = "yaak")]
#[command(about = "Yaak CLI - API client from the command line")]
struct Cli {
    /// Use a custom data directory
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,

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
        /// Show verbose output (headers, timing, etc.)
        #[arg(short, long)]
        verbose: bool,
    },
    /// Send a GET request to a URL
    Get {
        /// URL to request
        url: String,
        /// Show verbose output (headers, timing, etc.)
        #[arg(short, long)]
        verbose: bool,
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

    let data_dir = cli.data_dir.unwrap_or_else(|| {
        dirs::data_dir()
            .expect("Could not determine data directory")
            .join("com.yaak.app") // Match Tauri's app identifier
    });

    let db_path = data_dir.join("db.sqlite");
    let blob_path = data_dir.join("blobs.sqlite");

    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize database");

    let db = query_manager.connect();

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
            let requests = db
                .list_http_requests(&workspace_id)
                .expect("Failed to list requests");
            if requests.is_empty() {
                println!("No requests found in workspace {}", workspace_id);
            } else {
                for req in requests {
                    println!("{} - {} {}", req.id, req.method, req.name);
                }
            }
        }
        Commands::Send { request_id, verbose } => {
            let request = db
                .get_http_request(&request_id)
                .expect("Failed to get request");

            if verbose {
                println!("> {} {}", request.method, request.url);
            }

            // Convert to sendable request (no template rendering for now)
            let sendable = SendableHttpRequest::from_http_request(
                &request,
                SendableHttpRequestOptions::default(),
            )
            .await
            .expect("Failed to build request");

            // Create event channel for progress
            let (event_tx, mut event_rx) = mpsc::channel(100);

            // Spawn task to print events if verbose
            let verbose_handle = if verbose {
                Some(tokio::spawn(async move {
                    while let Some(event) = event_rx.recv().await {
                        println!("{}", event);
                    }
                }))
            } else {
                // Drain events silently
                tokio::spawn(async move {
                    while event_rx.recv().await.is_some() {}
                });
                None
            };

            // Send the request
            let sender = ReqwestSender::new().expect("Failed to create HTTP client");
            let response = sender
                .send(sendable, event_tx)
                .await
                .expect("Failed to send request");

            // Wait for event handler to finish
            if let Some(handle) = verbose_handle {
                let _ = handle.await;
            }

            // Print response
            if verbose {
                println!();
            }
            println!("HTTP {} {}", response.status, response.status_reason.as_deref().unwrap_or(""));

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
        Commands::Get { url, verbose } => {
            if verbose {
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
            let verbose_handle = if verbose {
                Some(tokio::spawn(async move {
                    while let Some(event) = event_rx.recv().await {
                        println!("{}", event);
                    }
                }))
            } else {
                tokio::spawn(async move {
                    while event_rx.recv().await.is_some() {}
                });
                None
            };

            // Send the request
            let sender = ReqwestSender::new().expect("Failed to create HTTP client");
            let response = sender
                .send(sendable, event_tx)
                .await
                .expect("Failed to send request");

            if let Some(handle) = verbose_handle {
                let _ = handle.await;
            }

            // Print response
            if verbose {
                println!();
            }
            println!("HTTP {} {}", response.status, response.status_reason.as_deref().unwrap_or(""));

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
}
