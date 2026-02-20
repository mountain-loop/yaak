use crate::cli::SendArgs;
use crate::commands::request;
use crate::context::CliContext;
use futures::future::join_all;

enum ExecutionMode {
    Sequential,
    Parallel,
}

pub async fn run(
    ctx: &CliContext,
    args: SendArgs,
    environment: Option<&str>,
    verbose: bool,
) -> i32 {
    match send_target(ctx, args, environment, verbose).await {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

async fn send_target(
    ctx: &CliContext,
    args: SendArgs,
    environment: Option<&str>,
    verbose: bool,
) -> Result<(), String> {
    let mode = if args.parallel { ExecutionMode::Parallel } else { ExecutionMode::Sequential };

    if ctx.db().get_any_request(&args.id).is_ok() {
        return request::send_request_by_id(ctx, &args.id, environment, verbose).await;
    }

    if ctx.db().get_folder(&args.id).is_ok() {
        let request_ids = collect_folder_request_ids(ctx, &args.id)?;
        if request_ids.is_empty() {
            println!("No requests found in folder {}", args.id);
            return Ok(());
        }
        return send_many(ctx, request_ids, mode, args.fail_fast, environment, verbose).await;
    }

    if ctx.db().get_workspace(&args.id).is_ok() {
        let request_ids = collect_workspace_request_ids(ctx, &args.id)?;
        if request_ids.is_empty() {
            println!("No requests found in workspace {}", args.id);
            return Ok(());
        }
        return send_many(ctx, request_ids, mode, args.fail_fast, environment, verbose).await;
    }

    Err(format!("Could not resolve ID '{}' as request, folder, or workspace", args.id))
}

fn collect_folder_request_ids(ctx: &CliContext, folder_id: &str) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();

    let mut http_ids = ctx
        .db()
        .list_http_requests_for_folder_recursive(folder_id)
        .map_err(|e| format!("Failed to list HTTP requests in folder: {e}"))?
        .into_iter()
        .map(|r| r.id)
        .collect::<Vec<_>>();
    ids.append(&mut http_ids);

    let mut grpc_ids = ctx
        .db()
        .list_grpc_requests_for_folder_recursive(folder_id)
        .map_err(|e| format!("Failed to list gRPC requests in folder: {e}"))?
        .into_iter()
        .map(|r| r.id)
        .collect::<Vec<_>>();
    ids.append(&mut grpc_ids);

    let mut websocket_ids = ctx
        .db()
        .list_websocket_requests_for_folder_recursive(folder_id)
        .map_err(|e| format!("Failed to list WebSocket requests in folder: {e}"))?
        .into_iter()
        .map(|r| r.id)
        .collect::<Vec<_>>();
    ids.append(&mut websocket_ids);

    Ok(ids)
}

fn collect_workspace_request_ids(
    ctx: &CliContext,
    workspace_id: &str,
) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();

    let mut http_ids = ctx
        .db()
        .list_http_requests(workspace_id)
        .map_err(|e| format!("Failed to list HTTP requests in workspace: {e}"))?
        .into_iter()
        .map(|r| r.id)
        .collect::<Vec<_>>();
    ids.append(&mut http_ids);

    let mut grpc_ids = ctx
        .db()
        .list_grpc_requests(workspace_id)
        .map_err(|e| format!("Failed to list gRPC requests in workspace: {e}"))?
        .into_iter()
        .map(|r| r.id)
        .collect::<Vec<_>>();
    ids.append(&mut grpc_ids);

    let mut websocket_ids = ctx
        .db()
        .list_websocket_requests(workspace_id)
        .map_err(|e| format!("Failed to list WebSocket requests in workspace: {e}"))?
        .into_iter()
        .map(|r| r.id)
        .collect::<Vec<_>>();
    ids.append(&mut websocket_ids);

    Ok(ids)
}

async fn send_many(
    ctx: &CliContext,
    request_ids: Vec<String>,
    mode: ExecutionMode,
    fail_fast: bool,
    environment: Option<&str>,
    verbose: bool,
) -> Result<(), String> {
    let mut success_count = 0usize;
    let mut failures: Vec<(String, String)> = Vec::new();

    match mode {
        ExecutionMode::Sequential => {
            for request_id in request_ids {
                match request::send_request_by_id(ctx, &request_id, environment, verbose).await {
                    Ok(()) => success_count += 1,
                    Err(error) => {
                        failures.push((request_id, error));
                        if fail_fast {
                            break;
                        }
                    }
                }
            }
        }
        ExecutionMode::Parallel => {
            let tasks = request_ids
                .iter()
                .map(|request_id| async move {
                    (
                        request_id.clone(),
                        request::send_request_by_id(ctx, request_id, environment, verbose).await,
                    )
                })
                .collect::<Vec<_>>();

            for (request_id, result) in join_all(tasks).await {
                match result {
                    Ok(()) => success_count += 1,
                    Err(error) => failures.push((request_id, error)),
                }
            }
        }
    }

    let failure_count = failures.len();
    println!("Send summary: {success_count} succeeded, {failure_count} failed");

    if failure_count == 0 {
        return Ok(());
    }

    for (request_id, error) in failures {
        eprintln!("  {}: {}", request_id, error);
    }
    Err("One or more requests failed".to_string())
}
