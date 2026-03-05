mod cli;
mod commands;
mod context;
mod plugin_events;
mod ui;
mod utils;
mod version;
mod version_check;

use clap::Parser;
use cli::{Cli, Commands, PluginCommands, RequestCommands};
use context::{CliContext, CliExecutionContext};
use yaak_models::queries::any_request::AnyRequest;

#[tokio::main]
async fn main() {
    let Cli { data_dir, environment, cookie_jar, verbose, log, command } = Cli::parse();

    if let Some(log_level) = log {
        match log_level {
            Some(level) => {
                env_logger::Builder::new().filter_level(level.as_filter()).init();
            }
            None => {
                env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
                    .init();
            }
        }
    }

    let app_id = if cfg!(debug_assertions) { "app.yaak.desktop.dev" } else { "app.yaak.desktop" };

    let data_dir = data_dir.unwrap_or_else(|| {
        dirs::data_dir().expect("Could not determine data directory").join(app_id)
    });

    version_check::maybe_check_for_updates().await;

    let exit_code = match command {
        Commands::Auth(args) => commands::auth::run(args).await,
        Commands::Plugin(args) => match args.command {
            PluginCommands::Build(args) => commands::plugin::run_build(args).await,
            PluginCommands::Dev(args) => commands::plugin::run_dev(args).await,
            PluginCommands::Generate(args) => commands::plugin::run_generate(args).await,
            PluginCommands::Publish(args) => commands::plugin::run_publish(args).await,
            PluginCommands::Install(install_args) => {
                let mut context = CliContext::new(data_dir.clone(), app_id);
                context.init_plugins(CliExecutionContext::default()).await;
                let exit_code = commands::plugin::run_install(&context, install_args).await;
                context.shutdown().await;
                exit_code
            }
        },
        Commands::Build(args) => commands::plugin::run_build(args).await,
        Commands::Dev(args) => commands::plugin::run_dev(args).await,
        Commands::Generate(args) => commands::plugin::run_generate(args).await,
        Commands::Publish(args) => commands::plugin::run_publish(args).await,
        Commands::Send(args) => {
            let mut context = CliContext::new(data_dir.clone(), app_id);
            match resolve_send_execution_context(
                &context,
                &args.id,
                environment.as_deref(),
                cookie_jar.as_deref(),
            ) {
                Ok(execution_context) => {
                    context.init_plugins(execution_context).await;
                    let exit_code = commands::send::run(
                        &context,
                        args,
                        environment.as_deref(),
                        cookie_jar.as_deref(),
                        verbose,
                    )
                    .await;
                    context.shutdown().await;
                    exit_code
                }
                Err(error) => {
                    eprintln!("Error: {error}");
                    1
                }
            }
        }
        Commands::CookieJar(args) => {
            let context = CliContext::new(data_dir.clone(), app_id);
            let exit_code = commands::cookie_jar::run(&context, args);
            context.shutdown().await;
            exit_code
        }
        Commands::Workspace(args) => {
            let context = CliContext::new(data_dir.clone(), app_id);
            let exit_code = commands::workspace::run(&context, args);
            context.shutdown().await;
            exit_code
        }
        Commands::Request(args) => {
            let mut context = CliContext::new(data_dir.clone(), app_id);
            let execution_context_result = match &args.command {
                RequestCommands::Send { request_id } => resolve_request_execution_context(
                    &context,
                    request_id,
                    environment.as_deref(),
                    cookie_jar.as_deref(),
                ),
                _ => Ok(CliExecutionContext::default()),
            };
            match execution_context_result {
                Ok(execution_context) => {
                    let with_plugins = matches!(
                        &args.command,
                        RequestCommands::Send { .. } | RequestCommands::Schema { .. }
                    );
                    if with_plugins {
                        context.init_plugins(execution_context).await;
                    }
                    let exit_code = commands::request::run(
                        &context,
                        args,
                        environment.as_deref(),
                        cookie_jar.as_deref(),
                        verbose,
                    )
                    .await;
                    context.shutdown().await;
                    exit_code
                }
                Err(error) => {
                    eprintln!("Error: {error}");
                    1
                }
            }
        }
        Commands::Folder(args) => {
            let context = CliContext::new(data_dir.clone(), app_id);
            let exit_code = commands::folder::run(&context, args);
            context.shutdown().await;
            exit_code
        }
        Commands::Environment(args) => {
            let context = CliContext::new(data_dir.clone(), app_id);
            let exit_code = commands::environment::run(&context, args);
            context.shutdown().await;
            exit_code
        }
    };

    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}

fn resolve_send_execution_context(
    context: &CliContext,
    id: &str,
    environment: Option<&str>,
    explicit_cookie_jar_id: Option<&str>,
) -> Result<CliExecutionContext, String> {
    if let Ok(request) = context.db().get_any_request(id) {
        let (request_id, workspace_id) = match request {
            AnyRequest::HttpRequest(r) => (Some(r.id), r.workspace_id),
            AnyRequest::GrpcRequest(r) => (Some(r.id), r.workspace_id),
            AnyRequest::WebsocketRequest(r) => (Some(r.id), r.workspace_id),
        };
        let cookie_jar_id = resolve_cookie_jar_id(context, &workspace_id, explicit_cookie_jar_id)?;
        return Ok(CliExecutionContext {
            request_id,
            workspace_id: Some(workspace_id),
            environment_id: environment.map(str::to_string),
            cookie_jar_id,
        });
    }

    if let Ok(folder) = context.db().get_folder(id) {
        let cookie_jar_id =
            resolve_cookie_jar_id(context, &folder.workspace_id, explicit_cookie_jar_id)?;
        return Ok(CliExecutionContext {
            request_id: None,
            workspace_id: Some(folder.workspace_id),
            environment_id: environment.map(str::to_string),
            cookie_jar_id,
        });
    }

    if let Ok(workspace) = context.db().get_workspace(id) {
        let cookie_jar_id = resolve_cookie_jar_id(context, &workspace.id, explicit_cookie_jar_id)?;
        return Ok(CliExecutionContext {
            request_id: None,
            workspace_id: Some(workspace.id),
            environment_id: environment.map(str::to_string),
            cookie_jar_id,
        });
    }

    Err(format!("Could not resolve ID '{}' as request, folder, or workspace", id))
}

fn resolve_request_execution_context(
    context: &CliContext,
    request_id: &str,
    environment: Option<&str>,
    explicit_cookie_jar_id: Option<&str>,
) -> Result<CliExecutionContext, String> {
    let request = context
        .db()
        .get_any_request(request_id)
        .map_err(|e| format!("Failed to get request: {e}"))?;

    let workspace_id = match request {
        AnyRequest::HttpRequest(r) => r.workspace_id,
        AnyRequest::GrpcRequest(r) => r.workspace_id,
        AnyRequest::WebsocketRequest(r) => r.workspace_id,
    };
    let cookie_jar_id = resolve_cookie_jar_id(context, &workspace_id, explicit_cookie_jar_id)?;

    Ok(CliExecutionContext {
        request_id: Some(request_id.to_string()),
        workspace_id: Some(workspace_id),
        environment_id: environment.map(str::to_string),
        cookie_jar_id,
    })
}

fn resolve_cookie_jar_id(
    context: &CliContext,
    workspace_id: &str,
    explicit_cookie_jar_id: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(cookie_jar_id) = explicit_cookie_jar_id {
        return Ok(Some(cookie_jar_id.to_string()));
    }

    let default_cookie_jar = context
        .db()
        .list_cookie_jars(workspace_id)
        .map_err(|e| format!("Failed to list cookie jars: {e}"))?
        .into_iter()
        .min_by_key(|jar| jar.created_at)
        .map(|jar| jar.id);
    Ok(default_cookie_jar)
}
