mod cli;
mod commands;
mod context;
mod utils;

use clap::Parser;
use cli::{Cli, Commands, RequestCommands};
use context::CliContext;

#[tokio::main]
async fn main() {
    let Cli { data_dir, environment, verbose, command } = Cli::parse();

    if verbose {
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    }

    let app_id = if cfg!(debug_assertions) { "app.yaak.desktop.dev" } else { "app.yaak.desktop" };

    let data_dir = data_dir.unwrap_or_else(|| {
        dirs::data_dir().expect("Could not determine data directory").join(app_id)
    });

    let needs_plugins = matches!(
        &command,
        Commands::Send(_)
            | Commands::Request(cli::RequestArgs { command: RequestCommands::Send { .. } })
    );

    let context = CliContext::initialize(data_dir, app_id, needs_plugins).await;

    let exit_code = match command {
        Commands::Send(args) => {
            commands::send::run(&context, args, environment.as_deref(), verbose).await
        }
        Commands::Workspace(args) => commands::workspace::run(&context, args),
        Commands::Request(args) => {
            commands::request::run(&context, args, environment.as_deref(), verbose).await
        }
        Commands::Folder(args) => commands::folder::run(&context, args),
        Commands::Environment(args) => commands::environment::run(&context, args),
    };

    context.shutdown().await;

    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}
