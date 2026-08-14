use crate::cli::{ResponseArgs, ResponseCommands};
use crate::context::CliContext;
use crate::utils::confirm::confirm_delete;
use crate::utils::workspace::resolve_workspace_id;
use std::io::Write;
use yaak_models::models::HttpResponse;
use yaak_models::util::UpdateSource;

type CommandResult<T = ()> = std::result::Result<T, String>;

pub fn run(ctx: &CliContext, args: ResponseArgs) -> i32 {
    let result = match args.command {
        ResponseCommands::List { id, limit } => list(ctx, id.as_deref(), limit),
        ResponseCommands::Show { id } => show(ctx, &id),
        ResponseCommands::Body { id } => body(ctx, &id),
        ResponseCommands::Delete { id, yes } => delete(ctx, &id, yes),
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

/// Accepts a response ID, or a request ID meaning "the latest response for that request".
fn resolve_response(ctx: &CliContext, id: &str) -> CommandResult<HttpResponse> {
    if let Ok(response) = ctx.db().get_http_response(id) {
        return Ok(response);
    }

    if ctx.db().get_http_request(id).is_ok() {
        return ctx
            .db()
            .list_http_responses_for_request(id, Some(1))
            .map_err(|e| format!("Failed to list responses: {e}"))?
            .into_iter()
            .next()
            .ok_or_else(|| format!("Request {id} has no stored responses yet"));
    }

    Err(format!("Could not resolve ID '{id}' as a response or request"))
}

fn list(ctx: &CliContext, id: Option<&str>, limit: Option<u64>) -> CommandResult {
    // An explicit request ID scopes to that request; anything else lists the workspace.
    let responses = match id {
        Some(id) if ctx.db().get_http_request(id).is_ok() => ctx
            .db()
            .list_http_responses_for_request(id, limit)
            .map_err(|e| format!("Failed to list responses: {e}"))?,
        other => {
            let workspace_id = resolve_workspace_id(ctx, other, "response list")?;
            ctx.db()
                .list_http_responses(&workspace_id, limit)
                .map_err(|e| format!("Failed to list responses: {e}"))?
        }
    };

    if responses.is_empty() {
        println!("No responses found");
        return Ok(());
    }

    for response in responses {
        let status = match response.error {
            // Errors can be a paragraph of nested debug output; `show` has the full text.
            Some(error) => {
                let first_line = error.lines().next().unwrap_or_default();
                let summary = match first_line.char_indices().nth(80) {
                    Some((cut, _)) => format!("{}...", &first_line[..cut]),
                    None => first_line.to_string(),
                };
                format!("ERROR {summary}")
            }
            None => {
                let reason = response.status_reason.unwrap_or_default();
                format!("{} {}", response.status, reason).trim_end().to_string()
            }
        };
        println!("{} - {} {} ({}ms)", response.id, status, response.url, response.elapsed);
    }

    Ok(())
}

fn show(ctx: &CliContext, id: &str) -> CommandResult {
    let response = resolve_response(ctx, id)?;
    let output = serde_json::to_string_pretty(&response)
        .map_err(|e| format!("Failed to serialize response: {e}"))?;
    println!("{output}");
    Ok(())
}

fn body(ctx: &CliContext, id: &str) -> CommandResult {
    let response = resolve_response(ctx, id)?;
    let Some(body_path) = response.body_path else {
        return Err(format!("Response {} has no stored body", response.id));
    };

    let bytes = std::fs::read(&body_path)
        .map_err(|e| format!("Failed to read response body at {body_path}: {e}"))?;

    let mut stdout = std::io::stdout();
    stdout.write_all(&bytes).map_err(|e| format!("Failed to write response body: {e}"))?;
    stdout.flush().map_err(|e| format!("Failed to flush response body: {e}"))?;
    Ok(())
}

fn delete(ctx: &CliContext, id: &str, yes: bool) -> CommandResult {
    // Deleting is scoped to a whole request or workspace, since a single stored
    // response is rarely the thing someone wants to remove.
    if ctx.db().get_http_request(id).is_ok() {
        if !yes && !confirm_delete("responses for request", id) {
            println!("Aborted");
            return Ok(());
        }
        let count = ctx
            .db()
            .delete_all_http_responses_for_request(id, &UpdateSource::Sync)
            .map_err(|e| format!("Failed to delete responses: {e}"))?;
        println!("Deleted {count} responses for request {id}");
        return Ok(());
    }

    let workspace_id = resolve_workspace_id(ctx, Some(id), "response delete")?;
    if !yes && !confirm_delete("responses for workspace", &workspace_id) {
        println!("Aborted");
        return Ok(());
    }
    let count = ctx
        .db()
        .delete_all_http_responses_for_workspace(&workspace_id, &UpdateSource::Sync)
        .map_err(|e| format!("Failed to delete responses: {e}"))?;
    println!("Deleted {count} responses for workspace {workspace_id}");
    Ok(())
}
