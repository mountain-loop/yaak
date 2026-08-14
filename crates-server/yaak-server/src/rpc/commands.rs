//! The implemented commands.
//!
//! Request payloads mirror the desktop's structs in
//! crates-tauri/yaak-app-client/src/rpc_ext.rs field for field, because the
//! frontend is unchanged and sends the same JSON. They are redeclared rather
//! than shared: those live in a Tauri crate this one must not depend on, and
//! they are plain data. The command *bodies* are what matter, and they call the
//! same engine functions the desktop calls.

use super::{BridgeCtx, UNSUPPORTED_COMMANDS, unsupported_command};
use mime_guess::{Mime, mime};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::str::FromStr;
use yaak::import::{ImportDataParams, import_data as import_data_shared};
use yaak::models_ops::{delete_model, duplicate_model, upsert_model};
use yaak::send::{SendHttpRequestWithPluginsParams, send_http_request_with_plugins};
use yaak_core::WorkspaceContext;
use yaak_models::models::{
    AnyModel, Environment, GraphQlIntrospection, GrpcEvent, HttpRequest, HttpRequestHeader,
    HttpResponse, HttpResponseEvent, HttpResponseState, Settings, WebsocketEvent, WorkspaceMeta,
};
use yaak_models::render::make_vars_hashmap;
use yaak_models::queries::workspaces::default_headers;
use yaak_models::util::BatchUpsertResult;
use yaak_plugins::events::{
    CallFolderActionRequest, CallHttpRequestActionRequest, CallWorkspaceActionRequest,
    FilterResponse, GetFolderActionsResponse, GetHttpAuthenticationConfigResponse,
    GetHttpAuthenticationSummaryResponse, GetHttpRequestActionsResponse,
    GetTemplateFunctionConfigResponse, GetTemplateFunctionSummaryResponse, GetThemesResponse,
    GetWorkspaceActionsResponse, JsonPrimitive, RenderPurpose,
};
use yaak_plugins::native_template_functions::{
    decrypt_secure_template_function, encrypt_secure_template_function,
};
use yaak_plugins::plugin_meta::PluginMetadata;
use yaak_rpc::{RpcError, RpcRouter, rpc_handler_async};
use yaak_sse::sse::ServerSentEvent;
use yaak_templates::format_json::format_json;
use yaak_templates::{
    RenderErrorBehavior, RenderOptions, TemplateCallback, Tokens, parse_and_render,
    render_json_value_raw,
};

type Result<T> = std::result::Result<T, RpcError>;

/// Any engine error becomes an RPC error with its message, matching how the
/// desktop's `rpc` command flattens its error enum before it crosses the wire.
fn err(e: impl std::fmt::Display) -> RpcError {
    RpcError { message: e.to_string() }
}

/// Run database work that opens a transaction off the async runtime.
///
/// A `rusqlite` transaction borrows a connection that is neither `Send` nor
/// `Sync`, so a future holding one cannot be spawned. Moving it to a blocking
/// thread satisfies that and is the right shape anyway — these are synchronous
/// disk writes that can cascade.
async fn blocking<T, F>(f: F) -> Result<T>
where
    F: FnOnce() -> std::result::Result<T, yaak_models::error::Error> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(result) => result.map_err(err),
        Err(e) => Err(RpcError { message: format!("Database task failed: {e}") }),
    }
}

macro_rules! rpc_commands {
    ( $( $name:ident ),* $(,)? ) => {
        pub fn build_router() -> RpcRouter<BridgeCtx> {
            let mut router = RpcRouter::new();
            $( router.register(stringify!($name), rpc_handler_async!($name)); )*
            for cmd in UNSUPPORTED_COMMANDS {
                router.register(
                    cmd,
                    Box::new(move |_ctx, _payload| {
                        let cmd = *cmd;
                        Box::pin(async move { Err(unsupported_command(cmd)) })
                    }),
                );
            }
            router
        }
    };
}

// -- App metadata --

#[derive(Debug, Deserialize)]
pub struct EmptyReq {}

/// Deliberately not the desktop's `AppMetaData`: that type lives in a Tauri
/// crate and half its fields are Tauri paths. The serialized shape is the same,
/// which is what the frontend reads.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMetaData {
    is_dev: bool,
    version: String,
    cli_version: Option<String>,
    name: String,
    app_data_dir: String,
    app_log_dir: String,
    vendored_plugin_dir: String,
    default_project_dir: String,
    feature_updater: bool,
    feature_license: bool,
}

async fn cmd_metadata(ctx: BridgeCtx, _req: EmptyReq) -> Result<BridgeMetaData> {
    let data_dir = ctx.state.data_dir().to_string_lossy().to_string();
    Ok(BridgeMetaData {
        is_dev: ctx.state.is_dev,
        version: env!("CARGO_PKG_VERSION").to_string(),
        cli_version: None,
        name: "Yaak Bridge".to_string(),
        app_data_dir: data_dir.clone(),
        app_log_dir: data_dir.clone(),
        vendored_plugin_dir: ctx
            .state
            .data_dir()
            .join("vendored-plugins")
            .to_string_lossy()
            .to_string(),
        default_project_dir: dirs::home_dir()
            .map(|d| d.join("YaakProjects"))
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        feature_updater: false,
        feature_license: false,
    })
}

// -- Models --

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsUpsertReq {
    pub model: AnyModel,
}

async fn models_upsert(ctx: BridgeCtx, req: ModelsUpsertReq) -> Result<String> {
    let db = ctx.state.db();
    upsert_model(&db, ctx.state.blob_manager(), req.model, &ctx.update_source()).map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsDeleteReq {
    pub model: AnyModel,
}

/// Deletes run on a blocking thread, as they do on the desktop: a transaction
/// holds a raw sqlite connection, which is neither `Send` nor cheap to hold —
/// dropping a workspace with thousands of requests would otherwise stall the
/// runtime and every other request with it.
async fn models_delete(ctx: BridgeCtx, req: ModelsDeleteReq) -> Result<String> {
    let source = ctx.update_source();
    blocking(move || {
        ctx.state
            .query_manager()
            .with_tx(|tx| delete_model(tx, ctx.state.blob_manager(), req.model, &source))
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsDuplicateReq {
    pub model_type: String,
    pub model_id: String,
}

async fn models_duplicate(ctx: BridgeCtx, req: ModelsDuplicateReq) -> Result<String> {
    let source = ctx.update_source();
    blocking(move || {
        ctx.state
            .query_manager()
            .with_tx(|tx| duplicate_model(tx, &req.model_type, &req.model_id, &source))
    })
    .await
}

async fn models_get_settings(ctx: BridgeCtx, _req: EmptyReq) -> Result<Settings> {
    Ok(ctx.state.db().get_settings())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsWorkspaceModelsReq {
    pub workspace_id: Option<String>,
}

/// Everything the frontend's model store needs for a workspace, as one JSON
/// string.
///
/// The desktop escapes non-ASCII into `\uXXXX` before handing this to the
/// webview; that is a workaround for Tauri's IPC and would only corrupt a
/// perfectly good UTF-8 HTTP response body, so the bridge returns the string as
/// serialized. The frontend `JSON.parse`s either form identically.
async fn models_workspace_models(ctx: BridgeCtx, req: ModelsWorkspaceModelsReq) -> Result<String> {
    let mut l: Vec<AnyModel> = Vec::new();

    {
        let db = ctx.state.db();
        l.push(db.get_settings().into());
        l.append(&mut db.list_workspaces().map_err(err)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_key_values().map_err(err)?.into_iter().map(Into::into).collect());
    }

    let plugins = ctx.state.db().list_plugins().map_err(err)?;
    if let Some(plugin_manager) = ctx.state.plugin_manager() {
        let plugins = plugin_manager.resolve_plugins_for_runtime_from_db(plugins).await;
        l.append(&mut plugins.into_iter().map(Into::into).collect());
    } else {
        l.append(&mut plugins.into_iter().map(Into::into).collect());
    }

    if let Some(wid) = req.workspace_id.as_deref() {
        let db = ctx.state.db();
        l.append(&mut db.list_cookie_jars(wid).map_err(err)?.into_iter().map(Into::into).collect());
        l.append(
            &mut db
                .list_environments_ensure_base(wid)
                .map_err(err)?
                .into_iter()
                .map(Into::into)
                .collect(),
        );
        l.append(&mut db.list_folders(wid).map_err(err)?.into_iter().map(Into::into).collect());
        l.append(
            &mut db.list_grpc_connections(wid).map_err(err)?.into_iter().map(Into::into).collect(),
        );
        l.append(
            &mut db.list_grpc_requests(wid).map_err(err)?.into_iter().map(Into::into).collect(),
        );
        l.append(
            &mut db.list_http_requests(wid).map_err(err)?.into_iter().map(Into::into).collect(),
        );
        l.append(
            &mut db
                .list_http_responses(wid, None)
                .map_err(err)?
                .into_iter()
                .map(Into::into)
                .collect(),
        );
        l.append(
            &mut db
                .list_websocket_connections(wid)
                .map_err(err)?
                .into_iter()
                .map(Into::into)
                .collect(),
        );
        l.append(
            &mut db.list_websocket_requests(wid).map_err(err)?.into_iter().map(Into::into).collect(),
        );
        l.append(
            &mut db.list_workspace_metas(wid).map_err(err)?.into_iter().map(Into::into).collect(),
        );
    }

    serde_json::to_string(&l).map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsWebsocketEventsReq {
    pub connection_id: String,
}

async fn models_websocket_events(
    ctx: BridgeCtx,
    req: ModelsWebsocketEventsReq,
) -> Result<Vec<WebsocketEvent>> {
    ctx.state.db().list_websocket_events(&req.connection_id).map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsGrpcEventsReq {
    pub connection_id: String,
}

async fn models_grpc_events(ctx: BridgeCtx, req: ModelsGrpcEventsReq) -> Result<Vec<GrpcEvent>> {
    ctx.state.db().list_grpc_events(&req.connection_id).map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsGetGraphqlIntrospectionReq {
    pub request_id: String,
}

async fn models_get_graphql_introspection(
    ctx: BridgeCtx,
    req: ModelsGetGraphqlIntrospectionReq,
) -> Result<Option<GraphQlIntrospection>> {
    Ok(ctx.state.db().get_graphql_introspection(&req.request_id))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsUpsertGraphqlIntrospectionReq {
    pub request_id: String,
    pub workspace_id: String,
    pub content: Option<String>,
}

async fn models_upsert_graphql_introspection(
    ctx: BridgeCtx,
    req: ModelsUpsertGraphqlIntrospectionReq,
) -> Result<GraphQlIntrospection> {
    ctx.state
        .db()
        .upsert_graphql_introspection(
            &req.workspace_id,
            &req.request_id,
            req.content,
            &ctx.update_source(),
        )
        .map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdGetWorkspaceMetaReq {
    pub workspace_id: String,
}

async fn cmd_get_workspace_meta(
    ctx: BridgeCtx,
    req: CmdGetWorkspaceMetaReq,
) -> Result<WorkspaceMeta> {
    let db = ctx.state.db();
    let workspace = db.get_workspace(&req.workspace_id).map_err(err)?;
    db.get_or_create_workspace_meta(&workspace.id).map_err(err)
}

// -- Sending --

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdSendHttpRequestReq {
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
    pub request_id: String,
}

/// Send a saved request.
///
/// Same sequence as the desktop (crates-tauri/.../lib.rs `cmd_send_http_request`):
/// create the response row first so the UI has something to show, wire up
/// cancellation, then hand off to the engine. Nothing is streamed back to the
/// tab directly — every state change is a database write, and the model-writes
/// push carries it, which is exactly how the desktop does it too.
async fn cmd_send_http_request(ctx: BridgeCtx, req: CmdSendHttpRequestReq) -> Result<HttpResponse> {
    let request = ctx.state.db().get_http_request(&req.request_id).map_err(err)?;
    let source = ctx.update_source();

    let response = ctx
        .state
        .db()
        .upsert_http_response(
            &HttpResponse {
                request_id: request.id.clone(),
                workspace_id: request.workspace_id.clone(),
                ..Default::default()
            },
            &source,
            ctx.state.blob_manager(),
        )
        .map_err(err)?;

    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let mut cancels =
        ctx.state.events.subscribe_inbound(format!("cancel_http_response_{}", response.id));
    tokio::spawn(async move {
        if cancels.recv().await.is_some() {
            let _ = cancel_tx.send(true);
        }
    });

    let result = send_persisted(&ctx, request, response.clone(), &req, cancel_rx).await;

    match result {
        Ok(response) => Ok(response),
        Err(e) => {
            // Mirror the desktop: a failure is a closed response carrying the
            // error, not a rejected command, so the UI shows it in place.
            let existing = ctx.state.db().get_http_response(&response.id).map_err(err)?;
            ctx.state
                .db()
                .upsert_http_response(
                    &HttpResponse {
                        state: HttpResponseState::Closed,
                        error: Some(e.message),
                        ..existing
                    },
                    &source,
                    ctx.state.blob_manager(),
                )
                .map_err(err)
        }
    }
}

async fn send_persisted(
    ctx: &BridgeCtx,
    request: HttpRequest,
    response: HttpResponse,
    req: &CmdSendHttpRequestReq,
    cancel_rx: tokio::sync::watch::Receiver<bool>,
) -> Result<HttpResponse> {
    let plugin_manager = ctx.plugins()?;
    let response_dir = ctx.state.response_dir();

    let result = send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
        query_manager: ctx.state.query_manager(),
        blob_manager: ctx.state.blob_manager(),
        request,
        environment_id: req.environment_id.as_deref(),
        update_source: ctx.update_source(),
        cookie_jar_id: req.cookie_jar_id.clone(),
        response_dir: &response_dir,
        emit_events_to: None,
        emit_response_body_chunks_to: None,
        existing_response: Some(response),
        plugin_manager,
        encryption_manager: ctx.state.encryption_manager.clone(),
        plugin_context: &ctx.plugin_context(),
        cancelled_rx: Some(cancel_rx),
        connection_manager: ctx.state.connection_manager(),
    })
    .await
    .map_err(err)?;

    Ok(result.response)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdSendEphemeralRequestReq {
    pub request: HttpRequest,
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
}

/// Send without saving. An empty request id keeps the engine from persisting
/// anything, so the body comes back in memory instead of on disk.
async fn cmd_send_ephemeral_request(
    ctx: BridgeCtx,
    req: CmdSendEphemeralRequestReq,
) -> Result<HttpResponse> {
    let mut request = req.request;
    request.id = String::new();
    let plugin_manager = ctx.plugins()?;
    let response_dir = ctx.state.response_dir();

    let result = send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
        query_manager: ctx.state.query_manager(),
        blob_manager: ctx.state.blob_manager(),
        request,
        environment_id: req.environment_id.as_deref(),
        update_source: ctx.update_source(),
        cookie_jar_id: req.cookie_jar_id,
        response_dir: &response_dir,
        emit_events_to: None,
        emit_response_body_chunks_to: None,
        existing_response: Some(HttpResponse::default()),
        plugin_manager,
        encryption_manager: ctx.state.encryption_manager.clone(),
        plugin_context: &ctx.plugin_context(),
        cancelled_rx: None,
        connection_manager: ctx.state.connection_manager(),
    })
    .await
    .map_err(err)?;

    Ok(result.response)
}

// -- Reading responses --

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdHttpResponseBodyReq {
    pub response: HttpResponse,
    pub filter: Option<String>,
}

async fn cmd_http_response_body(
    ctx: BridgeCtx,
    req: CmdHttpResponseBodyReq,
) -> Result<FilterResponse> {
    let Some(body_path) = req.response.body_path else {
        return Ok(FilterResponse { content: String::new(), error: None });
    };

    let content_type = req
        .response
        .headers
        .iter()
        .find_map(|h| {
            if h.name.eq_ignore_ascii_case("content-type") { Some(h.value.as_str()) } else { None }
        })
        .unwrap_or_default();

    let body = read_response_body(&body_path, content_type)
        .await
        .ok_or_else(|| RpcError { message: "Failed to find response body".to_string() })?;

    match req.filter.as_deref() {
        Some(filter) if !filter.is_empty() => ctx
            .plugins()?
            .filter_data(&ctx.plugin_context(), filter, &body, content_type)
            .await
            .map_err(err),
        _ => Ok(FilterResponse { content: body, error: None }),
    }
}

/// Decode a response body from disk using the charset its Content-Type
/// declares. Ported from crates-tauri/yaak-app-client/src/encoding.rs.
async fn read_response_body(body_path: impl AsRef<Path>, content_type: &str) -> Option<String> {
    let body = tokio::fs::read(body_path).await.ok()?;
    let body_charset = parse_charset(content_type).unwrap_or_else(|| "utf-8".to_string());
    if let Some(decoder) = charset::Charset::for_label(body_charset.as_bytes()) {
        let (cow, _real_encoding, _exist_replace) = decoder.decode(&body);
        return Some(cow.into_owned());
    }
    Some(String::from_utf8_lossy(&body).to_string())
}

fn parse_charset(content_type: &str) -> Option<String> {
    let mime: Mime = Mime::from_str(content_type).ok()?;
    mime.get_param(mime::CHARSET).map(|v| v.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdHttpRequestBodyReq {
    pub response_id: String,
}

async fn cmd_http_request_body(
    ctx: BridgeCtx,
    req: CmdHttpRequestBodyReq,
) -> Result<Option<Vec<u8>>> {
    let body_id = format!("{}.request", req.response_id);
    let chunks = ctx.state.blob_manager().connect().get_chunks(&body_id).map_err(err)?;
    if chunks.is_empty() {
        return Ok(None);
    }
    Ok(Some(chunks.into_iter().flat_map(|c| c.data).collect()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdGetHttpResponseEventsReq {
    pub response_id: String,
}

async fn cmd_get_http_response_events(
    ctx: BridgeCtx,
    req: CmdGetHttpResponseEventsReq,
) -> Result<Vec<HttpResponseEvent>> {
    ctx.state.db().list_http_response_events(&req.response_id).map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdGetSseEventsReq {
    pub file_path: String,
}

async fn cmd_get_sse_events(
    _ctx: BridgeCtx,
    req: CmdGetSseEventsReq,
) -> Result<Vec<ServerSentEvent>> {
    use eventsource_client::{EventParser, SSE};

    let body = std::fs::read(&req.file_path).map_err(err)?;
    let mut event_parser = EventParser::new();
    event_parser.process_bytes(body).map_err(err)?;

    let mut events = Vec::new();
    while let Some(e) = event_parser.get_event() {
        if let SSE::Event(e) = e {
            events.push(ServerSentEvent {
                event_type: e.event_type,
                data: e.data,
                id: e.id,
                retry: e.retry,
            });
        }
    }
    Ok(events)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdDeleteAllHttpResponsesReq {
    pub request_id: String,
}

async fn cmd_delete_all_http_responses(
    ctx: BridgeCtx,
    req: CmdDeleteAllHttpResponsesReq,
) -> Result<()> {
    ctx.state
        .db()
        .delete_all_http_responses_for_request(&req.request_id, &ctx.update_source())
        .map_err(err)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdDeleteSendHistoryReq {
    pub workspace_id: String,
}

async fn cmd_delete_send_history(ctx: BridgeCtx, req: CmdDeleteSendHistoryReq) -> Result<()> {
    let source = ctx.update_source();
    blocking(move || {
        let blobs = ctx.state.blob_manager();
        let db = ctx.state.db();
        for r in db.list_http_responses(&req.workspace_id, None)? {
            db.delete_http_response(&r, &source, blobs)?;
        }
        Ok(())
    })
    .await
}

// -- Formatting and templates --

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdFormatJsonReq {
    pub text: String,
}

async fn cmd_format_json(_ctx: BridgeCtx, req: CmdFormatJsonReq) -> Result<String> {
    Ok(format_json(&req.text, "  "))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdFormatGraphqlReq {
    pub text: String,
}

async fn cmd_format_graphql(_ctx: BridgeCtx, req: CmdFormatGraphqlReq) -> Result<String> {
    match pretty_graphql::format_text(&req.text, &Default::default()) {
        Ok(formatted) => Ok(formatted),
        Err(_) => Ok(req.text),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdRenderTemplateReq {
    pub template: String,
    pub workspace_id: String,
    pub environment_id: Option<String>,
    pub purpose: Option<RenderPurpose>,
    pub ignore_error: Option<bool>,
}

async fn cmd_render_template(ctx: BridgeCtx, req: CmdRenderTemplateReq) -> Result<String> {
    let environment_chain = ctx
        .state
        .db()
        .resolve_environments(&req.workspace_id, None, req.environment_id.as_deref())
        .map_err(err)?;

    let callback = yaak_plugins::template_callback::PluginTemplateCallback::new(
        ctx.plugins()?,
        ctx.state.encryption_manager.clone(),
        &ctx.plugin_context(),
        req.purpose.unwrap_or(RenderPurpose::Preview),
    );

    let options = RenderOptions {
        error_behavior: match req.ignore_error {
            Some(true) => RenderErrorBehavior::ReturnEmpty,
            _ => RenderErrorBehavior::Throw,
        },
    };
    let vars = make_vars_hashmap(environment_chain);
    parse_and_render(&req.template, &vars, &callback, &options).await.map_err(err)
}

async fn render_json_value<T: TemplateCallback>(
    value: serde_json::Value,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<serde_json::Value> {
    let vars = &make_vars_hashmap(environment_chain);
    render_json_value_raw(value, vars, cb, opt).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdTemplateTokensToStringReq {
    pub tokens: Tokens,
}

async fn cmd_template_tokens_to_string(
    _ctx: BridgeCtx,
    req: CmdTemplateTokensToStringReq,
) -> Result<String> {
    Ok(req.tokens.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdDecryptTemplateReq {
    pub template: String,
}

async fn cmd_decrypt_template(ctx: BridgeCtx, req: CmdDecryptTemplateReq) -> Result<String> {
    decrypt_secure_template_function(
        &ctx.state.encryption_manager,
        &ctx.plugin_context(),
        &req.template,
    )
    .map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdSecureTemplateReq {
    pub template: String,
}

async fn cmd_secure_template(ctx: BridgeCtx, req: CmdSecureTemplateReq) -> Result<String> {
    encrypt_secure_template_function(
        ctx.plugins()?,
        ctx.state.encryption_manager.clone(),
        &ctx.plugin_context(),
        &req.template,
    )
    .map_err(err)
}

async fn cmd_default_headers(_ctx: BridgeCtx, _req: EmptyReq) -> Result<Vec<HttpRequestHeader>> {
    Ok(default_headers())
}

// -- Plugins --

async fn cmd_get_themes(ctx: BridgeCtx, _req: EmptyReq) -> Result<Vec<GetThemesResponse>> {
    // Themes are optional: the TypeScript package ships defaults, and an empty
    // list still renders. Don't fail boot when the runtime is down.
    let Ok(plugins) = ctx.plugins() else {
        return Ok(Vec::new());
    };
    plugins.get_themes(&ctx.plugin_context()).await.map_err(err)
}

async fn cmd_plugin_init_errors(ctx: BridgeCtx, _req: EmptyReq) -> Result<Vec<(String, String)>> {
    let Ok(plugins) = ctx.plugins() else {
        return Ok(Vec::new());
    };
    Ok(plugins.take_init_errors().await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdPluginInfoReq {
    pub id: String,
}

async fn cmd_plugin_info(ctx: BridgeCtx, req: CmdPluginInfoReq) -> Result<PluginMetadata> {
    let plugin = ctx.state.db().get_plugin(&req.id).map_err(err)?;
    let plugins = ctx.plugins()?;
    let handle = plugins
        .get_plugin_by_dir(&plugin.directory)
        .await
        .ok_or_else(|| RpcError { message: format!("Plugin not found: {}", req.id) })?;
    Ok(handle.info())
}

async fn cmd_template_function_summaries(
    ctx: BridgeCtx,
    _req: EmptyReq,
) -> Result<Vec<GetTemplateFunctionSummaryResponse>> {
    ctx.plugins()?.get_template_function_summaries(&ctx.plugin_context()).await.map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdTemplateFunctionConfigReq {
    pub function_name: String,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    /// Sent by the frontend, unused here — same as the desktop, which takes it
    /// as `_environment_id`. Template function values are not pre-rendered the
    /// way auth values are.
    #[allow(dead_code)]
    pub environment_id: Option<String>,
}

async fn cmd_template_function_config(
    ctx: BridgeCtx,
    req: CmdTemplateFunctionConfigReq,
) -> Result<GetTemplateFunctionConfigResponse> {
    ctx.plugins()?
        .get_template_function_config(
            &ctx.plugin_context(),
            &req.function_name,
            req.values,
            req.model.id(),
        )
        .await
        .map_err(err)
}

async fn cmd_get_http_authentication_summaries(
    ctx: BridgeCtx,
    _req: EmptyReq,
) -> Result<Vec<GetHttpAuthenticationSummaryResponse>> {
    let results =
        ctx.plugins()?.get_http_authentication_summaries(&ctx.plugin_context()).await.map_err(err)?;
    Ok(results.into_iter().map(|(_, a)| a).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdGetHttpAuthenticationConfigReq {
    pub auth_name: String,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    pub environment_id: Option<String>,
}

async fn cmd_get_http_authentication_config(
    ctx: BridgeCtx,
    req: CmdGetHttpAuthenticationConfigReq,
) -> Result<GetHttpAuthenticationConfigResponse> {
    let rendered_values =
        render_auth_values(&ctx, &req.model, req.environment_id.as_deref(), &req.values).await?;
    ctx.plugins()?
        .get_http_authentication_config(
            &ctx.plugin_context(),
            &req.auth_name,
            rendered_values,
            req.model.id(),
        )
        .await
        .map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdCallHttpAuthenticationActionReq {
    pub auth_name: String,
    pub action_index: i32,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    pub environment_id: Option<String>,
}

async fn cmd_call_http_authentication_action(
    ctx: BridgeCtx,
    req: CmdCallHttpAuthenticationActionReq,
) -> Result<()> {
    let rendered_values =
        render_auth_values(&ctx, &req.model, req.environment_id.as_deref(), &req.values).await?;
    ctx.plugins()?
        .call_http_authentication_action(
            &ctx.plugin_context(),
            &req.auth_name,
            req.action_index,
            rendered_values,
            req.model.id(),
        )
        .await
        .map_err(err)
}

/// Auth config values are templates, so they are rendered against the model's
/// environment chain before the plugin sees them.
async fn render_auth_values(
    ctx: &BridgeCtx,
    model: &AnyModel,
    environment_id: Option<&str>,
    values: &HashMap<String, JsonPrimitive>,
) -> Result<HashMap<String, JsonPrimitive>> {
    let (workspace_id, folder_id) = match model {
        AnyModel::HttpRequest(r) => (r.workspace_id.clone(), r.folder_id.clone()),
        AnyModel::GrpcRequest(r) => (r.workspace_id.clone(), r.folder_id.clone()),
        AnyModel::WebsocketRequest(r) => (r.workspace_id.clone(), r.folder_id.clone()),
        AnyModel::Folder(f) => (f.workspace_id.clone(), f.folder_id.clone()),
        AnyModel::Workspace(w) => (w.id.clone(), None),
        _ => {
            return Err(RpcError {
                message: "Unsupported model type for authentication config".to_string(),
            });
        }
    };

    let environment_chain = ctx
        .state
        .db()
        .resolve_environments(&workspace_id, folder_id.as_deref(), environment_id)
        .map_err(err)?;

    let callback = yaak_plugins::template_callback::PluginTemplateCallback::new(
        ctx.plugins()?,
        ctx.state.encryption_manager.clone(),
        &ctx.plugin_context(),
        RenderPurpose::Preview,
    );

    let values_json = serde_json::to_value(values).map_err(err)?;
    let rendered_json =
        render_json_value(values_json, environment_chain, &callback, &RenderOptions::return_empty())
            .await
            .map_err(err)?;
    serde_json::from_value(rendered_json).map_err(err)
}

// -- Plugin actions --

async fn cmd_http_request_actions(
    ctx: BridgeCtx,
    _req: EmptyReq,
) -> Result<Vec<GetHttpRequestActionsResponse>> {
    ctx.plugins()?.get_http_request_actions(&ctx.plugin_context()).await.map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdCallHttpRequestActionReq {
    pub req: CallHttpRequestActionRequest,
}

async fn cmd_call_http_request_action(
    ctx: BridgeCtx,
    req: CmdCallHttpRequestActionReq,
) -> Result<()> {
    use yaak_plugins::events::CallHttpRequestActionArgs;

    // Resolve inherited auth and headers before handing the request to the
    // plugin, so an action sees what a send would see. Scoped so the database
    // connection is released before the plugin call awaits.
    let http_request = {
        let db = ctx.state.db();
        let mut http_request = req.req.args.http_request.clone();
        let (authentication_type, authentication, _) =
            db.resolve_auth_for_http_request(&http_request).map_err(err)?;
        http_request.authentication_type = authentication_type;
        http_request.authentication = authentication;
        http_request.headers = db.resolve_headers_for_http_request(&http_request).map_err(err)?;
        http_request
    };

    ctx.plugins()?
        .call_http_request_action(
            &ctx.plugin_context(),
            CallHttpRequestActionRequest {
                args: CallHttpRequestActionArgs { http_request },
                ..req.req
            },
        )
        .await
        .map_err(err)
}

async fn cmd_workspace_actions(
    ctx: BridgeCtx,
    _req: EmptyReq,
) -> Result<Vec<GetWorkspaceActionsResponse>> {
    ctx.plugins()?.get_workspace_actions(&ctx.plugin_context()).await.map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdCallWorkspaceActionReq {
    pub req: CallWorkspaceActionRequest,
}

async fn cmd_call_workspace_action(ctx: BridgeCtx, req: CmdCallWorkspaceActionReq) -> Result<()> {
    use yaak_plugins::events::CallWorkspaceActionArgs;

    let workspace = ctx.state.db().get_workspace(&req.req.args.workspace.id).map_err(err)?;
    ctx.plugins()?
        .call_workspace_action(
            &ctx.plugin_context(),
            CallWorkspaceActionRequest { args: CallWorkspaceActionArgs { workspace }, ..req.req },
        )
        .await
        .map_err(err)
}

async fn cmd_folder_actions(ctx: BridgeCtx, _req: EmptyReq) -> Result<Vec<GetFolderActionsResponse>> {
    ctx.plugins()?.get_folder_actions(&ctx.plugin_context()).await.map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdCallFolderActionReq {
    pub req: CallFolderActionRequest,
}

async fn cmd_call_folder_action(ctx: BridgeCtx, req: CmdCallFolderActionReq) -> Result<()> {
    use yaak_plugins::events::CallFolderActionArgs;

    let folder = ctx.state.db().get_folder(&req.req.args.folder.id).map_err(err)?;
    ctx.plugins()?
        .call_folder_action(
            &ctx.plugin_context(),
            CallFolderActionRequest { args: CallFolderActionArgs { folder }, ..req.req },
        )
        .await
        .map_err(err)
}

// -- Import --

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdCurlToRequestReq {
    pub command: String,
    pub workspace_id: String,
}

async fn cmd_curl_to_request(ctx: BridgeCtx, req: CmdCurlToRequestReq) -> Result<HttpRequest> {
    let import_result =
        ctx.plugins()?.import_data(&ctx.plugin_context(), &req.command).await.map_err(err)?;

    let r = import_result
        .resources
        .http_requests
        .first()
        .ok_or_else(|| RpcError { message: "No curl command found".to_string() })?;

    let mut request = r.clone();
    request.workspace_id = req.workspace_id;
    request.id = String::new();
    Ok(request)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdImportDataReq {
    pub file_path: String,
}

/// Import from a path on the *bridge's* machine.
///
/// The desktop gets this path from a native file dialog. A tab has no way to
/// produce one, so in practice this only works for a path typed by hand — which
/// is why `localFiles` is reported false. Kept registered because the command
/// itself works, and a future upload route can reuse it.
async fn cmd_import_data(ctx: BridgeCtx, req: CmdImportDataReq) -> Result<BatchUpsertResult> {
    let contents = std::fs::read_to_string(&req.file_path).map_err(|e| RpcError {
        message: format!("Unable to read import file {}: {e}", req.file_path),
    })?;
    let plugins = ctx.plugins()?;

    import_data_shared(ImportDataParams {
        query_manager: ctx.state.query_manager(),
        plugin_manager: &plugins,
        plugin_context: &ctx.plugin_context(),
        workspace_context: WorkspaceContext {
            workspace_id: ctx.session.workspace_id(),
            environment_id: ctx.session.environment_id(),
            cookie_jar_id: ctx.session.cookie_jar_id(),
            request_id: None,
        },
        contents: &contents,
    })
    .await
    .map_err(err)
}

rpc_commands! {
    cmd_metadata,
    cmd_default_headers,
    cmd_get_themes,
    cmd_plugin_init_errors,
    cmd_plugin_info,

    models_upsert,
    models_delete,
    models_duplicate,
    models_get_settings,
    models_workspace_models,
    models_websocket_events,
    models_grpc_events,
    models_get_graphql_introspection,
    models_upsert_graphql_introspection,
    cmd_get_workspace_meta,

    cmd_send_http_request,
    cmd_send_ephemeral_request,

    cmd_http_response_body,
    cmd_http_request_body,
    cmd_get_http_response_events,
    cmd_get_sse_events,
    cmd_delete_all_http_responses,
    cmd_delete_send_history,

    cmd_format_json,
    cmd_format_graphql,
    cmd_render_template,
    cmd_template_tokens_to_string,
    cmd_decrypt_template,
    cmd_secure_template,

    cmd_template_function_summaries,
    cmd_template_function_config,
    cmd_get_http_authentication_summaries,
    cmd_get_http_authentication_config,
    cmd_call_http_authentication_action,

    cmd_http_request_actions,
    cmd_call_http_request_action,
    cmd_workspace_actions,
    cmd_call_workspace_action,
    cmd_folder_actions,
    cmd_call_folder_action,

    cmd_curl_to_request,
    cmd_import_data,
}

/// Command names this host implements, for the capability report.
pub fn implemented_commands(router: &RpcRouter<BridgeCtx>) -> Vec<String> {
    let unsupported: std::collections::HashSet<&str> =
        UNSUPPORTED_COMMANDS.iter().copied().collect();
    let mut names: Vec<String> = router
        .commands()
        .into_iter()
        .filter(|c| !unsupported.contains(c))
        .map(|c| c.to_string())
        .collect();
    names.sort();
    names
}
