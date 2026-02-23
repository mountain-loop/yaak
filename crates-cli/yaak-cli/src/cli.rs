use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "yaak")]
#[command(about = "Yaak CLI - API client from the command line")]
#[command(version = crate::version::cli_version())]
#[command(disable_help_subcommand = true)]
#[command(after_help = r#"Agent Hints:
  - Template variable syntax is ${[ my_var ]}, not {{ ... }}
  - Template function syntax is ${[ namespace.my_func(a='aaa',b='bbb') ]}
  - View JSONSchema for models before creating or updating (eg. `yaak request schema http`)
  - Deletion requires confirmation (--yes for non-interactive environments)
  "#)]
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
    /// Authentication commands
    Auth(AuthArgs),

    /// Plugin development and publishing commands
    Plugin(PluginArgs),

    #[command(hide = true)]
    Build(PluginPathArg),

    #[command(hide = true)]
    Dev(PluginPathArg),

    /// Send a request, folder, or workspace by ID
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
    /// Request, folder, or workspace ID
    pub id: String,

    /// Execute requests sequentially (default)
    #[arg(long, conflicts_with = "parallel")]
    pub sequential: bool,

    /// Execute requests in parallel
    #[arg(long, conflicts_with = "sequential")]
    pub parallel: bool,

    /// Stop on first request failure when sending folders/workspaces
    #[arg(long, conflicts_with = "parallel")]
    pub fail_fast: bool,
}

#[derive(Args)]
#[command(disable_help_subcommand = true)]
pub struct WorkspaceArgs {
    #[command(subcommand)]
    pub command: WorkspaceCommands,
}

#[derive(Subcommand)]
pub enum WorkspaceCommands {
    /// List all workspaces
    List,

    /// Output JSON schema for workspace create/update payloads
    Schema {
        /// Pretty-print schema JSON output
        #[arg(long)]
        pretty: bool,
    },

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
#[command(disable_help_subcommand = true)]
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

    /// Send a request by ID
    Send {
        /// Request ID
        request_id: String,
    },

    /// Output JSON schema for request create/update payloads
    Schema {
        #[arg(value_enum)]
        request_type: RequestSchemaType,

        /// Pretty-print schema JSON output
        #[arg(long)]
        pretty: bool,
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

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum RequestSchemaType {
    Http,
    Grpc,
    Websocket,
}

#[derive(Args)]
#[command(disable_help_subcommand = true)]
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
#[command(disable_help_subcommand = true)]
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

    /// Output JSON schema for environment create/update payloads
    Schema {
        /// Pretty-print schema JSON output
        #[arg(long)]
        pretty: bool,
    },

    /// Show an environment as JSON
    Show {
        /// Environment ID
        environment_id: String,
    },

    /// Create an environment
    #[command(after_help = r#"Modes (choose one):
  1) yaak environment create <workspace_id> --name <name>
  2) yaak environment create --json '{"workspaceId":"wk_abc","name":"Production"}'
  3) yaak environment create '{"workspaceId":"wk_abc","name":"Production"}'

Do not combine <workspace_id> with --json."#)]
    Create {
        /// Workspace ID for flag-based mode, or positional JSON payload shorthand
        #[arg(value_name = "WORKSPACE_ID_OR_JSON")]
        workspace_id: Option<String>,

        /// Environment name
        #[arg(short, long)]
        name: Option<String>,

        /// JSON payload (use instead of WORKSPACE_ID/--name)
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

#[derive(Args)]
#[command(disable_help_subcommand = true)]
pub struct AuthArgs {
    #[command(subcommand)]
    pub command: AuthCommands,
}

#[derive(Subcommand)]
pub enum AuthCommands {
    /// Login to Yaak via web browser
    Login,

    /// Sign out of the Yaak CLI
    Logout,

    /// Print the current logged-in user's info
    Whoami,
}

#[derive(Args)]
#[command(disable_help_subcommand = true)]
pub struct PluginArgs {
    #[command(subcommand)]
    pub command: PluginCommands,
}

#[derive(Subcommand)]
pub enum PluginCommands {
    /// Transpile code into a runnable plugin bundle
    Build(PluginPathArg),

    /// Build plugin bundle continuously when the filesystem changes
    Dev(PluginPathArg),

    /// Generate a "Hello World" Yaak plugin
    Generate(GenerateArgs),

    /// Publish a Yaak plugin version to the plugin registry
    Publish(PluginPathArg),
}

#[derive(Args, Clone)]
pub struct PluginPathArg {
    /// Path to plugin directory (defaults to current working directory)
    pub path: Option<PathBuf>,
}

#[derive(Args, Clone)]
pub struct GenerateArgs {
    /// Plugin name (defaults to a generated name in interactive mode)
    #[arg(long)]
    pub name: Option<String>,

    /// Output directory for the generated plugin (defaults to ./<name> in interactive mode)
    #[arg(long)]
    pub dir: Option<PathBuf>,
}
