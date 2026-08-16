//! Authentication config forms and their actions.
//!
//! Both commands here do the same preparation: the frontend sends the model
//! whose auth is being edited plus the values currently in the form, and those
//! values may contain templates. They have to be rendered against the model's
//! own environment chain before a plugin sees them, or an auth plugin receives
//! `${[ api_key ]}` where it expected a key.

use crate::error::{Error, Result};
use crate::host::PluginHost;
use crate::render::render_json_value;
use std::collections::HashMap;
use yaak_models::models::AnyModel;
use yaak_plugins::events::{
    GetHttpAuthenticationConfigResponse, GetHttpAuthenticationSummaryResponse, JsonPrimitive,
    RenderPurpose,
};
use yaak_rpc_schema::*;
use yaak_templates::RenderOptions;

pub async fn cmd_get_http_authentication_summaries<H: PluginHost>(
    host: H,
    _req: CmdGetHttpAuthenticationSummariesReq,
) -> Result<Vec<GetHttpAuthenticationSummaryResponse>> {
    host.http_authentication_summaries().await
}

pub async fn cmd_get_http_authentication_config<H: PluginHost>(
    host: H,
    req: CmdGetHttpAuthenticationConfigReq,
) -> Result<GetHttpAuthenticationConfigResponse> {
    // A config form is being displayed, so a template that cannot resolve
    // should show as blank rather than refuse to open the form.
    let values = render_auth_values(
        &host,
        &req.model,
        req.environment_id.as_deref(),
        req.values,
        RenderPurpose::Preview,
        &RenderOptions::return_empty(),
    )
    .await?;

    host.http_authentication_config(&req.auth_name, values, req.model.id()).await
}

pub async fn cmd_call_http_authentication_action<H: PluginHost>(
    host: H,
    req: CmdCallHttpAuthenticationActionReq,
) -> Result<()> {
    // An action actually uses these values, so an unresolvable template is an
    // error rather than an empty string that would silently authenticate wrong.
    let values = render_auth_values(
        &host,
        &req.model,
        req.environment_id.as_deref(),
        req.values,
        RenderPurpose::Send,
        &RenderOptions::throw(),
    )
    .await?;

    host.call_http_authentication_action(&req.auth_name, req.action_index, values, req.model.id())
        .await
}

/// Render the form's values against the environment chain the model sits in.
///
/// The chain depends on where the model lives — a request inherits through its
/// folder, a workspace has only its own — so the model is what decides which
/// variables are in scope.
async fn render_auth_values<H: PluginHost>(
    host: &H,
    model: &AnyModel,
    environment_id: Option<&str>,
    values: HashMap<String, JsonPrimitive>,
    purpose: RenderPurpose,
    options: &RenderOptions,
) -> Result<HashMap<String, JsonPrimitive>> {
    let (workspace_id, folder_id) = match model {
        AnyModel::HttpRequest(r) => (r.workspace_id.clone(), r.folder_id.clone()),
        AnyModel::GrpcRequest(r) => (r.workspace_id.clone(), r.folder_id.clone()),
        AnyModel::WebsocketRequest(r) => (r.workspace_id.clone(), r.folder_id.clone()),
        AnyModel::Folder(f) => (f.workspace_id.clone(), f.folder_id.clone()),
        AnyModel::Workspace(w) => (w.id.clone(), None),
        other => {
            return Err(Error::Generic(format!(
                "Cannot resolve authentication for a {}",
                other.model()
            )));
        }
    };

    let environment_chain =
        host.db().resolve_environments(&workspace_id, folder_id.as_deref(), environment_id)?;

    let cb = host.template_callback(purpose);
    let rendered =
        render_json_value(serde_json::to_value(&values)?, environment_chain, &cb, options).await?;

    Ok(serde_json::from_value(rendered)?)
}
