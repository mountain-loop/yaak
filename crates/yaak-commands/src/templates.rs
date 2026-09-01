//! Templates, the functions plugins put in them, and themes.
//!
//! Everything here needs the plugin runtime, but only for the one thing it
//! uniquely provides: running a template function. Resolving the environment
//! chain and deciding what a render should do about errors are ordinary work
//! and stay here, where every host gets them the same.

use crate::error::Result;
use crate::host::PluginHost;
use crate::render::{render_form_values, render_template};
use yaak_plugins::events::{
    GetTemplateFunctionConfigResponse, GetTemplateFunctionSummaryResponse, GetThemesResponse,
    RenderPurpose,
};
use yaak_rpc_schema::*;
use yaak_templates::{RenderErrorBehavior, RenderOptions, transform_args};

pub async fn cmd_render_template<H: PluginHost>(
    host: H,
    req: CmdRenderTemplateReq,
) -> Result<String> {
    let environment_chain =
        host.db().resolve_environments(&req.workspace_id, None, req.environment_id.as_deref())?;
    let cb = host.template_callback(req.purpose.unwrap_or(RenderPurpose::Preview)).await?;
    let options = RenderOptions {
        // A preview that throws would show the user an error where they expect
        // to see the value so far, so callers rendering *into the UI* ask for
        // empties instead.
        error_behavior: match req.ignore_error {
            Some(true) => RenderErrorBehavior::ReturnEmpty,
            _ => RenderErrorBehavior::Throw,
        },
    };
    Ok(render_template(&req.template, environment_chain, &cb, &options).await?)
}

/// Render only the *arguments* of a template's function calls, leaving the
/// calls themselves intact. This is what turns a parsed template back into
/// something displayable without evaluating it.
pub async fn cmd_template_tokens_to_string<H: PluginHost>(
    host: H,
    req: CmdTemplateTokensToStringReq,
) -> Result<String> {
    let cb = host.template_callback(RenderPurpose::Preview).await?;
    Ok(transform_args(req.tokens, &cb)?.to_string())
}

pub async fn cmd_template_function_summaries<H: PluginHost>(
    host: H,
    _req: CmdTemplateFunctionSummariesReq,
) -> Result<Vec<GetTemplateFunctionSummaryResponse>> {
    host.template_function_summaries().await
}

pub async fn cmd_template_function_config<H: PluginHost>(
    host: H,
    req: CmdTemplateFunctionConfigReq,
) -> Result<GetTemplateFunctionConfigResponse> {
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

    host.template_function_config(&req.function_name, values, req.model.id()).await
}

pub async fn cmd_get_themes<H: PluginHost>(
    host: H,
    _req: CmdGetThemesReq,
) -> Result<Vec<GetThemesResponse>> {
    host.themes().await
}
