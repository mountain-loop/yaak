//! The actions plugins contribute to the UI, and the calls that run them.
//!
//! Listing is a plain question for the plugin runtime. Calling is not: the
//! frontend sends back the model it was showing, and a plugin must act on what
//! that model *actually is* — re-read from the database, with inheritance
//! resolved — not on a snapshot the UI has been holding. That re-reading is the
//! work these handlers do.

use crate::error::{Error, Result};
use crate::host::PluginHost;
use crate::resolve::{resolve_grpc_request, resolve_http_request};
use yaak_models::models::HttpRequest;
use yaak_plugins::events::{
    CallFolderActionArgs, CallFolderActionRequest, CallGrpcRequestActionArgs,
    CallGrpcRequestActionRequest, CallHttpRequestActionArgs, CallHttpRequestActionRequest,
    CallWebsocketRequestActionArgs, CallWebsocketRequestActionRequest, CallWorkspaceActionArgs,
    CallWorkspaceActionRequest, GetFolderActionsResponse, GetGrpcRequestActionsResponse,
    GetHttpRequestActionsResponse, GetWebsocketRequestActionsResponse, GetWorkspaceActionsResponse,
};
use yaak_rpc_schema::*;

// -- Listing --

pub async fn cmd_http_request_actions<H: PluginHost>(
    host: H,
    _req: CmdHttpRequestActionsReq,
) -> Result<Vec<GetHttpRequestActionsResponse>> {
    host.http_request_actions().await
}

pub async fn cmd_websocket_request_actions<H: PluginHost>(
    host: H,
    _req: CmdWebsocketRequestActionsReq,
) -> Result<Vec<GetWebsocketRequestActionsResponse>> {
    host.websocket_request_actions().await
}

pub async fn cmd_grpc_request_actions<H: PluginHost>(
    host: H,
    _req: CmdGrpcRequestActionsReq,
) -> Result<Vec<GetGrpcRequestActionsResponse>> {
    host.grpc_request_actions().await
}

pub async fn cmd_workspace_actions<H: PluginHost>(
    host: H,
    _req: CmdWorkspaceActionsReq,
) -> Result<Vec<GetWorkspaceActionsResponse>> {
    host.workspace_actions().await
}

pub async fn cmd_folder_actions<H: PluginHost>(
    host: H,
    _req: CmdFolderActionsReq,
) -> Result<Vec<GetFolderActionsResponse>> {
    host.folder_actions().await
}

// -- Calling --

pub async fn cmd_call_http_request_action<H: PluginHost>(
    host: H,
    req: CmdCallHttpRequestActionReq,
) -> Result<()> {
    let inner = req.req;
    let http_request = resolve_http_request(&host.db(), &inner.args.http_request)?.0;
    host.call_http_request_action(CallHttpRequestActionRequest {
        args: CallHttpRequestActionArgs { http_request },
        ..inner
    })
    .await
}

pub async fn cmd_call_grpc_request_action<H: PluginHost>(
    host: H,
    req: CmdCallGrpcRequestActionReq,
) -> Result<()> {
    let inner = req.req;
    let grpc_request = resolve_grpc_request(&host.db(), &inner.args.grpc_request)?.0;
    host.call_grpc_request_action(CallGrpcRequestActionRequest {
        args: CallGrpcRequestActionArgs { grpc_request, ..inner.args },
        ..inner
    })
    .await
}

pub async fn cmd_call_websocket_request_action<H: PluginHost>(
    host: H,
    req: CmdCallWebsocketRequestActionReq,
) -> Result<()> {
    let inner = req.req;
    let websocket_request = host.db().get_websocket_request(&inner.args.websocket_request.id)?;
    host.call_websocket_request_action(CallWebsocketRequestActionRequest {
        args: CallWebsocketRequestActionArgs { websocket_request },
        ..inner
    })
    .await
}

pub async fn cmd_call_workspace_action<H: PluginHost>(
    host: H,
    req: CmdCallWorkspaceActionReq,
) -> Result<()> {
    let inner = req.req;
    let workspace = host.db().get_workspace(&inner.args.workspace.id)?;
    host.call_workspace_action(CallWorkspaceActionRequest {
        args: CallWorkspaceActionArgs { workspace },
        ..inner
    })
    .await
}

pub async fn cmd_call_folder_action<H: PluginHost>(
    host: H,
    req: CmdCallFolderActionReq,
) -> Result<()> {
    let inner = req.req;
    let folder = host.db().get_folder(&inner.args.folder.id)?;
    host.call_folder_action(CallFolderActionRequest {
        args: CallFolderActionArgs { folder },
        ..inner
    })
    .await
}

// -- Other things the plugin runtime does --

/// Turn a `curl` command line into an unsaved request, by handing it to the
/// same importer plugins that read files.
pub async fn cmd_curl_to_request<H: PluginHost>(
    host: H,
    req: CmdCurlToRequestReq,
) -> Result<HttpRequest> {
    let imported = host.import_data(&req.command).await?;

    let request = imported
        .resources
        .http_requests
        .first()
        .ok_or_else(|| Error::Generic("No curl command found".to_string()))?;

    // Belongs to the workspace the user is importing into, and is not saved
    // until they say so — hence the blank id.
    let mut request = request.clone();
    request.workspace_id = req.workspace_id;
    request.id = String::new();
    Ok(request)
}

/// Restart every plugin, returning whatever failed to come back up.
pub async fn cmd_reload_plugins<H: PluginHost>(
    host: H,
    _req: CmdReloadPluginsReq,
) -> Result<Vec<(String, String)>> {
    let plugins = host.db().list_plugins()?;
    Ok(host.reload_plugins(plugins).await)
}
