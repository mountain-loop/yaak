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

    /// Folder commands
    Folder(FolderArgs),

    /// Environment commands
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

    /// Show a workspace as JSON
    Show {
        /// Workspace ID
        workspace_id: String,
    },

    /// Create a workspace
    Create {
        /// Workspace name
        #[arg(short, long)]
        name: Option<String>,

        /// JSON payload
        #[arg(long, conflicts_with = "json_input")]
        json: Option<String>,

        /// JSON payload shorthand
        #[arg(value_name = "JSON", conflicts_with = "json")]
        json_input: Option<String>,
    },

    /// Update a workspace
    Update {
        /// JSON payload
        #[arg(long, conflicts_with = "json_input")]
        json: Option<String>,

        /// JSON payload shorthand
        #[arg(value_name = "JSON", conflicts_with = "json")]
        json_input: Option<String>,
    },

    /// Delete a workspace
    Delete {
        /// Workspace ID
        workspace_id: String,

        /// Skip confirmation prompt
        #[arg(short, long)]
        yes: bool,
    },
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
        /// Workspace ID (or positional JSON payload shorthand)
        workspace_id: Option<String>,

        /// Request name
        #[arg(short, long)]
        name: Option<String>,

        /// HTTP method
        #[arg(short, long)]
        method: Option<String>,

        /// URL
        #[arg(short, long)]
        url: Option<String>,

        /// JSON payload
        #[arg(long)]
        json: Option<String>,
    },

    /// Update an HTTP request
    Update {
        /// JSON payload
        #[arg(long, conflicts_with = "json_input")]
        json: Option<String>,

        /// JSON payload shorthand
        #[arg(value_name = "JSON", conflicts_with = "json")]
        json_input: Option<String>,
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
pub struct FolderArgs {
    #[command(subcommand)]
    pub command: FolderCommands,
}

#[derive(Subcommand)]
pub enum FolderCommands {
    /// List folders in a workspace
    List {
        /// Workspace ID
        workspace_id: String,
    },

    /// Show a folder as JSON
    Show {
        /// Folder ID
        folder_id: String,
    },

    /// Create a folder
    Create {
        /// Workspace ID (or positional JSON payload shorthand)
        workspace_id: Option<String>,

        /// Folder name
        #[arg(short, long)]
        name: Option<String>,

        /// JSON payload
        #[arg(long)]
        json: Option<String>,
    },

    /// Update a folder
    Update {
        /// JSON payload
        #[arg(long, conflicts_with = "json_input")]
        json: Option<String>,

        /// JSON payload shorthand
        #[arg(value_name = "JSON", conflicts_with = "json")]
        json_input: Option<String>,
    },

    /// Delete a folder
    Delete {
        /// Folder ID
        folder_id: String,

        /// Skip confirmation prompt
        #[arg(short, long)]
        yes: bool,
    },
}

#[derive(Args)]
pub struct EnvironmentArgs {
    #[command(subcommand)]
    pub command: EnvironmentCommands,
}

#[derive(Subcommand)]
pub enum EnvironmentCommands {
    /// List environments in a workspace
    List {
        /// Workspace ID
        workspace_id: String,
    },

    /// Show an environment as JSON
    Show {
        /// Environment ID
        environment_id: String,
    },

    /// Create an environment
    Create {
        /// Workspace ID (or positional JSON payload shorthand)
        workspace_id: Option<String>,

        /// Environment name
        #[arg(short, long)]
        name: Option<String>,

        /// JSON payload
        #[arg(long)]
        json: Option<String>,
    },

    /// Update an environment
    Update {
        /// JSON payload
        #[arg(long, conflicts_with = "json_input")]
        json: Option<String>,

        /// JSON payload shorthand
        #[arg(value_name = "JSON", conflicts_with = "json")]
        json_input: Option<String>,
    },

    /// Delete an environment
    Delete {
        /// Environment ID
        environment_id: String,

        /// Skip confirmation prompt
        #[arg(short, long)]
        yes: bool,
    },
}
