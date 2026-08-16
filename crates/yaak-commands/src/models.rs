//! Reads and writes of models, keyed by the client's identity so the frontend
//! can suppress its own echoes.

use crate::error::Result;
use crate::host::{Host, PluginHost};
use yaak_models::models::{
    AnyModel, GraphQlIntrospection, GrpcEvent, HttpRequestHeader, Settings, WebsocketEvent,
    WorkspaceMeta,
};
use yaak_models::queries::workspaces::default_headers;
use yaak_rpc_schema::*;

pub async fn models_upsert<H: Host>(host: H, req: ModelsUpsertReq) -> Result<String> {
    let db = host.db();
    let blobs = host.blob_manager();
    let source = host.update_source();
    Ok(yaak_models::models_ops::upsert_model(&db, blobs, req.model, &source)?)
}

/// Deletes cascade — a workspace can hold thousands of requests — and run in a
/// transaction, which holds a raw connection for the duration.
///
/// Whether that wants a blocking thread is the *host's* question, not the
/// delete's: a desktop with a multi-threaded runtime should keep this off the
/// runtime (see its adapter), while a single-threaded host has nothing to move
/// it to and runs it here. So this is the plain version, and a host that wants
/// to relocate it calls [`models_delete_blocking`] itself.
pub async fn models_delete<H: Host>(host: H, req: ModelsDeleteReq) -> Result<String> {
    models_delete_blocking(&host, req)
}

/// The body of [`models_delete`], callable from a blocking context.
pub fn models_delete_blocking<H: Host>(host: &H, req: ModelsDeleteReq) -> Result<String> {
    let source = host.update_source();
    Ok(host.query_manager().with_tx(|tx| {
        yaak_models::models_ops::delete_model(tx, host.blob_manager(), req.model, &source)
    })?)
}

/// Duplicates recurse, so this runs in a transaction too.
pub async fn models_duplicate<H: Host>(host: H, req: ModelsDuplicateReq) -> Result<String> {
    let source = host.update_source();
    Ok(host.query_manager().with_tx(|tx| {
        yaak_models::models_ops::duplicate_model(tx, &req.model_type, &req.model_id, &source)
    })?)
}

pub async fn models_websocket_events<H: Host>(
    host: H,
    req: ModelsWebsocketEventsReq,
) -> Result<Vec<WebsocketEvent>> {
    Ok(host.db().list_websocket_events(&req.connection_id)?)
}

pub async fn models_grpc_events<H: Host>(
    host: H,
    req: ModelsGrpcEventsReq,
) -> Result<Vec<GrpcEvent>> {
    Ok(host.db().list_grpc_events(&req.connection_id)?)
}

pub async fn models_get_settings<H: Host>(host: H, _req: ModelsGetSettingsReq) -> Result<Settings> {
    Ok(host.db().get_settings())
}

pub async fn models_get_graphql_introspection<H: Host>(
    host: H,
    req: ModelsGetGraphqlIntrospectionReq,
) -> Result<Option<GraphQlIntrospection>> {
    Ok(host.db().get_graphql_introspection(&req.request_id))
}

pub async fn models_upsert_graphql_introspection<H: Host>(
    host: H,
    req: ModelsUpsertGraphqlIntrospectionReq,
) -> Result<GraphQlIntrospection> {
    let source = host.update_source();
    Ok(host.db().upsert_graphql_introspection(
        &req.workspace_id,
        &req.request_id,
        req.content,
        &source,
    )?)
}

/// Everything the frontend's model store needs to boot, as one JSON string.
///
/// A string rather than a `Vec<AnyModel>` because the desktop has to escape
/// this payload before it crosses into the webview (see its adapter), and the
/// frontend `JSON.parse`s either form the same way.
pub async fn models_workspace_models<H: PluginHost>(
    host: H,
    req: ModelsWorkspaceModelsReq,
) -> Result<String> {
    let mut l: Vec<AnyModel> = Vec::new();

    // Add the global models
    {
        let db = host.db();
        l.push(db.get_settings().into());
        l.append(&mut db.list_workspaces()?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_key_values()?.into_iter().map(Into::into).collect());
    }

    let plugins = {
        let db = host.db();
        db.list_plugins()?
    };

    let plugins = host.resolve_plugins(plugins).await;
    l.append(&mut plugins.into_iter().map(Into::into).collect());

    // Add the workspace children
    if let Some(wid) = req.workspace_id.as_deref() {
        let db = host.db();
        l.append(&mut db.list_cookie_jars(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_environments_ensure_base(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_folders(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_grpc_connections(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_grpc_requests(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_http_requests(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_http_responses(wid, None)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_websocket_connections(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_websocket_requests(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_workspace_metas(wid)?.into_iter().map(Into::into).collect());
    }

    Ok(serde_json::to_string(&l)?)
}

pub async fn cmd_get_workspace_meta<H: Host>(
    host: H,
    req: CmdGetWorkspaceMetaReq,
) -> Result<WorkspaceMeta> {
    let db = host.db();
    let workspace = db.get_workspace(&req.workspace_id)?;
    Ok(db.get_or_create_workspace_meta(&workspace.id)?)
}

pub async fn cmd_delete_all_grpc_connections<H: Host>(
    host: H,
    req: CmdDeleteAllGrpcConnectionsReq,
) -> Result<()> {
    Ok(host.db().delete_all_grpc_connections_for_request(&req.request_id, &host.update_source())?)
}

pub async fn cmd_delete_all_http_responses<H: Host>(
    host: H,
    req: CmdDeleteAllHttpResponsesReq,
) -> Result<()> {
    host.db().delete_all_http_responses_for_request(&req.request_id, &host.update_source())?;
    Ok(())
}

pub async fn cmd_ws_delete_connections<H: Host>(
    host: H,
    req: CmdWsDeleteConnectionsReq,
) -> Result<()> {
    Ok(host
        .db()
        .delete_all_websocket_connections_for_request(&req.request_id, &host.update_source())?)
}

pub async fn cmd_delete_send_history<H: Host>(host: H, req: CmdDeleteSendHistoryReq) -> Result<()> {
    Ok(host.query_manager().with_tx(|tx| {
        let source = &host.update_source();
        tx.delete_all_http_responses_for_workspace(&req.workspace_id, source)?;
        tx.delete_all_grpc_connections_for_workspace(&req.workspace_id, source)?;
        tx.delete_all_websocket_connections_for_workspace(&req.workspace_id, source)?;
        Ok::<(), yaak_models::error::Error>(())
    })?)
}

pub async fn cmd_default_headers<H: Host>(
    _host: H,
    _req: CmdDefaultHeadersReq,
) -> Result<Vec<HttpRequestHeader>> {
    Ok(default_headers())
}
