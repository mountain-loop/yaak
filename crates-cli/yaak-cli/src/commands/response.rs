use crate::cli::{ResponseArgs, ResponseCommands};
use crate::commands::request::get_any_request;
use crate::context::CliContext;
use crate::utils::confirm::confirm_delete;
use crate::utils::workspace::resolve_workspace_id;
use std::io::Write;
use yaak_models::models::{
    GrpcConnection, GrpcEventType, HttpResponse, WebsocketConnection, WebsocketEventType,
};
use yaak_models::queries::any_request::AnyRequest;
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

/// What a request leaves behind when sent: an HTTP response, or the connection a gRPC or
/// WebSocket request opened, whose messages are its events.
enum StoredResponse {
    Http(HttpResponse),
    Grpc(GrpcConnection),
    Websocket(WebsocketConnection),
}

impl StoredResponse {
    fn id(&self) -> &str {
        match self {
            StoredResponse::Http(r) => &r.id,
            StoredResponse::Grpc(c) => &c.id,
            StoredResponse::Websocket(c) => &c.id,
        }
    }

    fn created_at(&self) -> impl Ord + use<> {
        match self {
            StoredResponse::Http(r) => r.created_at,
            StoredResponse::Grpc(c) => c.created_at,
            StoredResponse::Websocket(c) => c.created_at,
        }
    }
}

/// Accepts a response or connection ID, or a request ID meaning "the latest response for that
/// request".
fn resolve_response(ctx: &CliContext, id: &str) -> CommandResult<StoredResponse> {
    let db = ctx.db();
    if let Ok(response) = db.get_http_response(id) {
        return Ok(StoredResponse::Http(response));
    }
    if let Ok(connection) = db.get_grpc_connection(id) {
        return Ok(StoredResponse::Grpc(connection));
    }
    if let Ok(connection) = db.get_websocket_connection(id) {
        return Ok(StoredResponse::Websocket(connection));
    }

    let Ok(request) = get_any_request(ctx, id) else {
        return Err(format!("Could not resolve ID '{id}' as a response or request"));
    };
    let latest = list_for_request(ctx, &request, Some(1))?.into_iter().next();
    latest.ok_or_else(|| format!("Request {id} has no stored responses yet"))
}

fn list_for_request(
    ctx: &CliContext,
    request: &AnyRequest,
    limit: Option<u64>,
) -> CommandResult<Vec<StoredResponse>> {
    let db = ctx.db();
    let error = |e: yaak_models::error::Error| format!("Failed to list responses: {e}");
    Ok(match request {
        AnyRequest::HttpRequest(r) => db
            .list_http_responses_for_request(&r.id, limit)
            .map_err(error)?
            .into_iter()
            .map(StoredResponse::Http)
            .collect(),
        AnyRequest::GrpcRequest(r) => db
            .list_grpc_connections_for_request(&r.id, limit)
            .map_err(error)?
            .into_iter()
            .map(StoredResponse::Grpc)
            .collect(),
        AnyRequest::WebsocketRequest(r) => {
            let connections = db.list_websocket_connections_for_request(&r.id).map_err(error)?;
            let limit = limit.map_or(usize::MAX, |n| usize::try_from(n).unwrap_or(usize::MAX));
            connections.into_iter().take(limit).map(StoredResponse::Websocket).collect()
        }
    })
}

/// Every kind of stored response in a workspace, newest first, with `limit` applied to the
/// merged history rather than to each kind.
fn list_for_workspace(
    ctx: &CliContext,
    workspace_id: &str,
    limit: Option<u64>,
) -> CommandResult<Vec<StoredResponse>> {
    let db = ctx.db();
    let error = |e: yaak_models::error::Error| format!("Failed to list responses: {e}");
    // Each kind comes back newest first, so the newest `limit` overall are among the newest
    // `limit` of each kind.
    let mut responses = db
        .list_http_responses(workspace_id, limit)
        .map_err(error)?
        .into_iter()
        .map(StoredResponse::Http)
        .chain(
            db.list_grpc_connections(workspace_id)
                .map_err(error)?
                .into_iter()
                .map(StoredResponse::Grpc),
        )
        .chain(
            db.list_websocket_connections(workspace_id)
                .map_err(error)?
                .into_iter()
                .map(StoredResponse::Websocket),
        )
        .collect::<Vec<_>>();
    responses.sort_by_key(|r| std::cmp::Reverse(r.created_at()));
    if let Some(limit) = limit {
        responses.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
    }
    Ok(responses)
}

fn list(ctx: &CliContext, id: Option<&str>, limit: Option<u64>) -> CommandResult {
    // An explicit request ID scopes to that request; anything else lists the workspace.
    let responses = match id.map(|id| get_any_request(ctx, id)) {
        Some(Ok(request)) => list_for_request(ctx, &request, limit)?,
        _ => {
            let workspace_id = resolve_workspace_id(ctx, id, "response list")?;
            list_for_workspace(ctx, &workspace_id, limit)?
        }
    };

    if responses.is_empty() {
        println!("No responses found");
        return Ok(());
    }

    for response in responses {
        let (error, status, url, elapsed) = match &response {
            StoredResponse::Http(r) => {
                let reason = r.status_reason.clone().unwrap_or_default();
                let status = format!("{} {}", r.status, reason).trim_end().to_string();
                (r.error.as_deref(), status, r.url.as_str(), r.elapsed)
            }
            StoredResponse::Grpc(c) => {
                (c.error.as_deref(), format!("gRPC status {}", c.status), c.url.as_str(), c.elapsed)
            }
            StoredResponse::Websocket(c) => {
                (c.error.as_deref(), c.status.to_string(), c.url.as_str(), c.elapsed)
            }
        };
        let status = match error {
            // Errors can be a paragraph of nested debug output; `show` has the full text.
            Some(error) => {
                let first_line = error.lines().next().unwrap_or_default();
                let summary = match first_line.char_indices().nth(80) {
                    Some((cut, _)) => format!("{}...", &first_line[..cut]),
                    None => first_line.to_string(),
                };
                format!("ERROR {summary}")
            }
            None => status,
        };
        println!("{} - {} {} ({}ms)", response.id(), status, url, elapsed);
    }

    Ok(())
}

fn show(ctx: &CliContext, id: &str) -> CommandResult {
    let output = match resolve_response(ctx, id)? {
        StoredResponse::Http(r) => serde_json::to_string_pretty(&r),
        StoredResponse::Grpc(c) => serde_json::to_string_pretty(&c),
        StoredResponse::Websocket(c) => serde_json::to_string_pretty(&c),
    }
    .map_err(|e| format!("Failed to serialize response: {e}"))?;
    println!("{output}");
    Ok(())
}

/// An HTTP body as stored; for a gRPC or WebSocket connection, each message the server sent,
/// oldest first, one per line.
fn body(ctx: &CliContext, id: &str) -> CommandResult {
    let bytes = match resolve_response(ctx, id)? {
        StoredResponse::Http(response) => {
            let Some(body_path) = response.body_path else {
                return Err(format!("Response {} has no stored body", response.id));
            };
            std::fs::read(&body_path)
                .map_err(|e| format!("Failed to read response body at {body_path}: {e}"))?
        }
        StoredResponse::Grpc(connection) => {
            let mut events = ctx
                .db()
                .list_grpc_events(&connection.id)
                .map_err(|e| format!("Failed to list connection events: {e}"))?;
            events.sort_by_key(|e| e.created_at);
            let mut bytes = Vec::new();
            for event in events.iter().filter(|e| e.event_type == GrpcEventType::ServerMessage) {
                bytes.extend_from_slice(event.content.as_bytes());
                bytes.push(b'\n');
            }
            bytes
        }
        StoredResponse::Websocket(connection) => {
            let mut events = ctx
                .db()
                .list_websocket_events(&connection.id)
                .map_err(|e| format!("Failed to list connection events: {e}"))?;
            events.sort_by_key(|e| e.created_at);
            let mut bytes = Vec::new();
            for event in events.iter().filter(|e| {
                e.is_server
                    && matches!(
                        e.message_type,
                        WebsocketEventType::Text | WebsocketEventType::Binary
                    )
            }) {
                bytes.extend_from_slice(&event.message);
                bytes.push(b'\n');
            }
            bytes
        }
    };

    let mut stdout = std::io::stdout();
    stdout.write_all(&bytes).map_err(|e| format!("Failed to write response body: {e}"))?;
    stdout.flush().map_err(|e| format!("Failed to flush response body: {e}"))?;
    Ok(())
}

fn delete(ctx: &CliContext, id: &str, yes: bool) -> CommandResult {
    // Deleting is scoped to a whole request or workspace, since a single stored
    // response is rarely the thing someone wants to remove.
    if let Ok(request) = get_any_request(ctx, id) {
        if !yes && !confirm_delete("responses for request", id) {
            println!("Aborted");
            return Ok(());
        }
        let source = &UpdateSource::Sync;
        let count = ctx
            .query_manager()
            .with_tx(|tx| match &request {
                AnyRequest::HttpRequest(r) => {
                    tx.delete_all_http_responses_for_request(&r.id, source)
                }
                AnyRequest::GrpcRequest(r) => {
                    let count = tx.list_grpc_connections_for_request(&r.id, None)?.len();
                    tx.delete_all_grpc_connections_for_request(&r.id, source)?;
                    Ok(count)
                }
                AnyRequest::WebsocketRequest(r) => {
                    let count = tx.list_websocket_connections_for_request(&r.id)?.len();
                    tx.delete_all_websocket_connections_for_request(&r.id, source)?;
                    Ok(count)
                }
            })
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
        .query_manager()
        .with_tx(|tx| {
            let source = &UpdateSource::Sync;
            let grpc = tx.list_grpc_connections(&workspace_id)?.len();
            let websocket = tx.list_websocket_connections(&workspace_id)?.len();
            let http = tx.delete_all_http_responses_for_workspace(&workspace_id, source)?;
            tx.delete_all_grpc_connections_for_workspace(&workspace_id, source)?;
            tx.delete_all_websocket_connections_for_workspace(&workspace_id, source)?;
            Ok::<_, yaak_models::error::Error>(http + grpc + websocket)
        })
        .map_err(|e| format!("Failed to delete responses: {e}"))?;
    println!("Deleted {count} responses for workspace {workspace_id}");
    Ok(())
}
