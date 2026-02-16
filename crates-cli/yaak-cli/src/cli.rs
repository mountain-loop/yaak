use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "yaakcli")]
#[command(about = "Yaak CLI - API client from the command line")]
pub struct Cli {
    /// Use a custom data directory
    #[arg(long, global = true)]
    pub data_dir: Option<PathBuf>,

    /// Environment ID to use for variable substitution
    #[arg(long, short, global = true)]
    pub environment: Option<String>,

    /// Enable verbose logging
    #[arg(long, short, global = true)]
    pub verbose: bool,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Send an HTTP request by ID
    Send(SendArgs),

    /// Workspace commands
    Workspace(WorkspaceArgs),

    /// Request commands
    Request(RequestArgs),

    /// Folder commands (coming soon)
    #[command(hide = true)]
    Folder(FolderArgs),

    /// Environment commands (coming soon)
    #[command(hide = true)]
    Environment(EnvironmentArgs),
}

#[derive(Args)]
pub struct SendArgs {
    /// Request ID
    pub request_id: String,
}

#[derive(Args)]
pub struct WorkspaceArgs {
    #[command(subcommand)]
    pub command: WorkspaceCommands,
}

#[derive(Subcommand)]
pub enum WorkspaceCommands {
    /// List all workspaces
    List,
}

#[derive(Args)]
pub struct RequestArgs {
    #[command(subcommand)]
    pub command: RequestCommands,
}

#[derive(Subcommand)]
pub enum RequestCommands {
    /// List requests in a workspace
    List {
        /// Workspace ID
        workspace_id: String,
    },

    /// Show a request as JSON
    Show {
        /// Request ID
        request_id: String,
    },

    /// Send an HTTP request by ID
    Send {
        /// Request ID
        request_id: String,
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

    /// Delete a request
    Delete {
        /// Request ID
        request_id: String,

        /// Skip confirmation prompt
        #[arg(short, long)]
        yes: bool,
    },
}

#[derive(Args)]
pub struct FolderArgs {}

#[derive(Args)]
pub struct EnvironmentArgs {}
