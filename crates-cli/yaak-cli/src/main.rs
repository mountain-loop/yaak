use clap::{Parser, Subcommand};
use std::path::PathBuf;

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
}

fn main() {
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
    }
}
