use log::info;
use serde_json::Value;
use std::collections::BTreeMap;
pub use yaak::render::render_http_request;
use yaak_models::models::{Environment, GrpcRequest, HttpRequestHeader};
use yaak_models::render::make_vars_hashmap;
use yaak_templates::{RenderOptions, TemplateCallback, parse_and_render, render_json_value_raw};

pub async fn render_template<T: TemplateCallback>(
    template: &str,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<String> {
    let vars = &make_vars_hashmap(environment_chain);
    parse_and_render(template, vars, cb, &opt).await
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

pub async fn render_grpc_request<T: TemplateCallback>(
    r: &GrpcRequest,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<GrpcRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut metadata = Vec::new();
    for p in r.metadata.clone() {
        if !p.enabled {
            continue;
        }
        metadata.push(HttpRequestHeader {
            enabled: p.enabled,
            name: parse_and_render(p.name.as_str(), vars, cb, &opt).await?,
            value: parse_and_render(p.value.as_str(), vars, cb, &opt).await?,
            id: p.id,
        })
    }

    let authentication = {
        let mut disabled = false;
        let mut auth = BTreeMap::new();
        match r.authentication.get("disabled") {
            Some(Value::Bool(true)) => {
                disabled = true;
            }
            Some(Value::String(tmpl)) => {
                disabled = parse_and_render(tmpl.as_str(), vars, cb, &opt)
                    .await
                    .unwrap_or_default()
                    .is_empty();
                info!(
                    "Rendering authentication.disabled as a template: {disabled} from \"{tmpl}\""
                );
            }
            _ => {}
        }
        if disabled {
            auth.insert("disabled".to_string(), Value::Bool(true));
        } else {
            for (k, v) in r.authentication.clone() {
                if k == "disabled" {
                    auth.insert(k, Value::Bool(false));
                } else {
                    auth.insert(k, render_json_value_raw(v, vars, cb, &opt).await?);
                }
            }
        }
        auth
    };

    let url = parse_and_render(r.url.as_str(), vars, cb, &opt).await?;

    Ok(GrpcRequest { url, metadata, authentication, ..r.to_owned() })
}
