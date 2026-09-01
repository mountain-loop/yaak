//! Rendering a template against an environment chain.
//!
//! The variables come from the chain, the functions come from the host's
//! template callback. `render_template` and `render_json_value` know nothing
//! about which host they run under — that is the whole point of taking the
//! callback as a parameter. `render_form_values` sits one level up: resolving
//! the chain a model sits in is an ordinary database read, so it takes the
//! host and does that read before rendering.

use crate::error::{Error, Result};
use crate::host::PluginHost;
use serde_json::Value;
use std::collections::HashMap;
use yaak_models::models::{AnyModel, Environment};
use yaak_models::render::make_vars_hashmap;
use yaak_plugins::events::{JsonPrimitive, RenderPurpose};
use yaak_templates::{RenderOptions, TemplateCallback, parse_and_render, render_json_value_raw};

pub async fn render_template<T: TemplateCallback>(
    template: &str,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<String> {
    let vars = &make_vars_hashmap(environment_chain);
    parse_and_render(template, vars, cb, opt).await
}

pub async fn render_json_value<T: TemplateCallback>(
    value: Value,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<Value> {
    let vars = &make_vars_hashmap(environment_chain);
    render_json_value_raw(value, vars, cb, opt).await
}

/// Render a config form's values against the environment chain the model sits in.
///
/// The chain depends on where the model lives — a request inherits through its
/// folder, a workspace has only its own — so the model is what decides which
/// variables are in scope.
pub(crate) async fn render_form_values<H: PluginHost>(
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
                "Cannot resolve environments for a {}",
                other.model()
            )));
        }
    };

    let environment_chain =
        host.db().resolve_environments(&workspace_id, folder_id.as_deref(), environment_id)?;

    let cb = host.template_callback(purpose).await?;
    let rendered =
        render_json_value(serde_json::to_value(&values)?, environment_chain, &cb, options).await?;

    Ok(serde_json::from_value(rendered)?)
}
