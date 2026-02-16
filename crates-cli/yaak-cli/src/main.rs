mod cli;
mod commands;
mod context;

use clap::Parser;
use cli::{Cli, Commands};
use context::CliContext;

#[tokio::main]
async fn main() {
    let Cli { data_dir, environment, verbose, command } = Cli::parse();

    if verbose {
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    }

    let app_id = if cfg!(debug_assertions) { "app.yaak.desktop.dev" } else { "app.yaak.desktop" };

    let data_dir =
        data_dir.unwrap_or_else(|| dirs::data_dir().expect("Could not determine data directory").join(app_id));

    let context = CliContext::initialize(data_dir, app_id).await;

    let exit_code = match command {
        Commands::Send(args) => {
            commands::send::run(&context, args, environment.as_deref(), verbose).await;
            0
        }
        Commands::Workspace(args) => {
            commands::workspace::run(&context, args);
            0
        }
        Commands::Request(args) => {
            commands::request::run(&context, args, environment.as_deref(), verbose).await;
            0
        }
        Commands::Folder(_) => {
            eprintln!("Folder commands are not implemented yet");
            1
        }
        Commands::Environment(_) => {
            eprintln!("Environment commands are not implemented yet");
            1
        }
    };

    context.shutdown().await;

    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}
