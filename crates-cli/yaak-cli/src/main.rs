mod cli;
mod commands;
mod context;
mod plugin_events;
mod ui;
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

    let needs_context = matches!(
        &command,
        Commands::Send(_)
            | Commands::Workspace(_)
            | Commands::Request(_)
            | Commands::Folder(_)
            | Commands::Environment(_)
    );

    let needs_plugins = matches!(
        &command,
        Commands::Send(_)
            | Commands::Request(cli::RequestArgs {
                command: RequestCommands::Send { .. } | RequestCommands::Schema { .. },
            })
    );

    let context = if needs_context {
        Some(CliContext::initialize(data_dir, app_id, needs_plugins).await)
    } else {
        None
    };

    let exit_code = match command {
        Commands::Auth(args) => commands::auth::run(args).await,
        Commands::Plugin(args) => commands::plugin::run(args).await,
        Commands::Build(args) => commands::plugin::run_build(args).await,
        Commands::Dev(args) => commands::plugin::run_dev(args).await,
        Commands::Send(args) => {
            commands::send::run(
                context.as_ref().expect("context initialized for send"),
                args,
                environment.as_deref(),
                verbose,
            )
            .await
        }
        Commands::Workspace(args) => commands::workspace::run(
            context.as_ref().expect("context initialized for workspace"),
            args,
        ),
        Commands::Request(args) => {
            commands::request::run(
                context.as_ref().expect("context initialized for request"),
                args,
                environment.as_deref(),
                verbose,
            )
            .await
        }
        Commands::Folder(args) => {
            commands::folder::run(context.as_ref().expect("context initialized for folder"), args)
        }
        Commands::Environment(args) => commands::environment::run(
            context.as_ref().expect("context initialized for environment"),
            args,
        ),
    };

    if let Some(context) = &context {
        context.shutdown().await;
    }

    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}
