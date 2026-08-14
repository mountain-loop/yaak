use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

pub const AGENT_HINTS: &str = r#"Agent Hints:
  - Template variable syntax is ${[ my_var ]}, not {{ ... }}
  - Template function syntax is ${[ namespace.my_func(a='aaa',b='bbb') ]}
  - View JSONSchema for models before creating or updating (eg. `yaak request schema http`)
  - Deletion requires confirmation (--yes for non-interactive environments)"#;

#[derive(Parser)]
#[command(name = "yaak")]
#[command(about = "Yaak CLI - API client from the command line")]
#[command(version = crate::version::cli_version())]
#[command(disable_help_subcommand = true)]
pub struct Cli {
    /// Use a custom data directory
    #[arg(long, global = true)]
    pub data_dir: Option<PathBuf>,

    /// Environment ID to use for variable substitution
    #[arg(long, short, global = true)]
    pub environment: Option<String>,

    /// Cookie jar ID to use when sending requests
    #[arg(long = "cookie-jar", global = true, value_name = "COOKIE_JAR_ID")]
    pub cookie_jar: Option<String>,

    /// Enable verbose send output (events and streamed response body)
    #[arg(long, short, global = true)]
    pub verbose: bool,

    /// Enable CLI logging; optionally set level (error|warn|info|debug|trace)
    #[arg(long, global = true, value_name = "LEVEL", num_args = 0..=1, ignore_case = true)]
    pub log: Option<Option<LogLevel>>,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Install Yaak skills for AI coding agents
    Agent(AgentArgs),

    /// Authentication commands
    Auth(AuthArgs),

    /// Import API data from Yaak, OpenAPI, Postman, Insomnia, Swagger, or cURL
    Import(ImportArgs),

    /// Export Yaak workspace data
    Export(ExportArgs),

    /// Plugin development and publishing commands
    Plugin(PluginArgs),

    #[command(hide = true)]
    Build(PluginPathArg),

    #[command(hide = true)]
    Dev(PluginPathArg),

    /// Backward-compatible alias for `plugin generate`
    #[command(hide = true)]
    Generate(GenerateArgs),

    /// Backward-compatible alias for `plugin publish`
    #[command(hide = true)]
    Publish(PluginPathArg),

    /// Send a request, folder, or workspace by ID
    Send(SendArgs),

    /// Cookie jar commands
    CookieJar(CookieJarArgs),

    /// Workspace commands
    Workspace(WorkspaceArgs),

    /// Request commands
    Request(RequestArgs),

    /// Folder commands
    Folder(FolderArgs),

    /// Environment commands
    Environment(EnvironmentArgs),

    /// Template function commands
    #[command(alias = "func")]
    TemplateFunction(TemplateFunctionArgs),

    /// Response commands
    Response(ResponseArgs),
}

#[derive(Args)]
pub struct ResponseArgs {
    #[command(subcommand)]
    pub command: ResponseCommands,
}

#[derive(Subcommand)]
pub enum ResponseCommands {
    /// List stored responses for a request or workspace
    List {
        /// Request or workspace ID (optional when exactly one workspace exists)
        id: Option<String>,

        /// Maximum number of responses to return, newest first
        #[arg(long)]
        limit: Option<u64>,
    },

    /// Show a response as JSON, including status, timing, and headers
    Show {
        /// Response ID, or a request ID to use its most recent response
        id: String,
    },

    /// Write a stored response body to stdout
    Body {
        /// Response ID, or a request ID to use its most recent response
        id: String,
    },

    /// Delete stored responses for a request or workspace
    Delete {
        /// Request or workspace ID
        id: String,

        /// Skip confirmation prompt
        #[arg(short, long)]
        yes: bool,
    },
}

#[derive(Args)]
pub struct TemplateFunctionArgs {
    #[command(subcommand)]
    pub command: TemplateFunctionCommands,
}

#[derive(Subcommand)]
pub enum TemplateFunctionCommands {
    /// List template functions provided by installed plugins
    List {
        /// Only show functions whose name contains this text
        #[arg(value_name = "FILTER")]
        filter: Option<String>,
    },

    /// Show a template function's arguments as JSON
    Show {
        /// Template function name (for example: response.body.path)
        name: String,

        /// Pretty-print JSON output
        #[arg(long)]
        pretty: bool,
    },
}

#[derive(Args)]
pub struct AgentArgs {
    #[command(subcommand)]
    pub command: AgentCommands,
}

#[derive(Subcommand)]
pub enum AgentCommands {
    /// Install the Yaak skill so coding agents know how to drive the CLI
    #[command(alias = "update", alias = "add")]
    Install {
        /// Install for specific agents instead of all detected ones
        #[arg(long = "agent", value_name = "AGENT")]
        agent: Option<Vec<String>>,
    },

    /// Remove the Yaak skill
    #[command(alias = "uninstall", alias = "rm")]
    Remove {
        /// Remove for specific agents instead of all detected ones
        #[arg(long = "agent", value_name = "AGENT")]
        agent: Option<Vec<String>>,
    },
}

#[derive(Args)]
pub struct SendArgs {
    /// Request, folder, or workspace ID
    pub id: String,

    /// Execute requests in parallel
    #[arg(long)]
    pub parallel: bool,

    /// Stop on first request failure when sending folders/workspaces
    #[arg(long, conflicts_with = "parallel")]
    pub fail_fast: bool,
}

#[derive(Args)]
pub struct ImportArgs {
    /// Path to the file to import
    pub file: PathBuf,

    /// Existing workspace ID to import into when supported by the importer
    #[arg(long = "workspace-id", value_name = "WORKSPACE_ID")]
    pub workspace_id: Option<String>,
}

#[derive(Args)]
pub struct ExportArgs {
    /// Path to write the Yaak export JSON file
    pub file: PathBuf,

    /// Workspace IDs to export (defaults to the only workspace when exactly one exists)
    #[arg(value_name = "WORKSPACE_ID")]
    pub workspace_ids: Vec<String>,

    /// Export all workspaces
    #[arg(long, conflicts_with = "workspace_ids")]
    pub all: bool,

    /// Include private environments in the export
    #[arg(long)]
    pub include_private_environments: bool,
}

#[derive(Args)]
#[command(disable_help_subcommand = true)]
pub struct CookieJarArgs {
    #[command(subcommand)]
    pub command: CookieJarCommands,
}

#[derive(Subcommand)]
pub enum CookieJarCommands {
    /// List cookie jars in a workspace
    List {
        /// Workspace ID (optional when exactly one workspace exists)
        workspace_id: Option<String>,
    },
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
        /// Workspace ID (optional when exactly one workspace exists)
        workspace_id: Option<String>,
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

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevel {
    pub fn as_filter(self) -> log::LevelFilter {
        match self {
            LogLevel::Error => log::LevelFilter::Error,
            LogLevel::Warn => log::LevelFilter::Warn,
            LogLevel::Info => log::LevelFilter::Info,
            LogLevel::Debug => log::LevelFilter::Debug,
            LogLevel::Trace => log::LevelFilter::Trace,
        }
    }
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
        /// Workspace ID (optional when exactly one workspace exists)
        workspace_id: Option<String>,
    },

    /// Output JSON schema for folder create/update payloads
    Schema {
        /// Pretty-print schema JSON output
        #[arg(long)]
        pretty: bool,
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
        /// Workspace ID (optional when exactly one workspace exists)
        workspace_id: Option<String>,
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
  4) yaak environment create <workspace_id> --json '{"name":"Production"}'
"#)]
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

    /// Install a plugin from a local directory or from the registry
    Install(InstallPluginArgs),

    /// Generate plugin metadata for the registry
    #[command(hide = true)]
    Metadata(PluginPathArg),

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

#[derive(Args, Clone)]
pub struct InstallPluginArgs {
    /// Local plugin directory path, or registry plugin spec (@org/plugin[@version])
    pub source: String,
}
