//! Authentication config forms and their actions.
//!
//! Both commands here do the same preparation: the frontend sends the model
//! whose auth is being edited plus the values currently in the form, and those
//! values may contain templates. They have to be rendered against the model's
//! own environment chain before a plugin sees them, or an auth plugin receives
//! `${[ api_key ]}` where it expected a key.

use crate::error::Result;
use crate::host::PluginHost;
use crate::render::render_form_values;
use yaak_plugins::events::{
    GetHttpAuthenticationConfigResponse, GetHttpAuthenticationSummaryResponse, RenderPurpose,
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
    let values = render_form_values(
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
    let values = render_form_values(
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
