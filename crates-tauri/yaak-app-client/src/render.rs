use serde_json::Value;
pub use yaak::render::{render_grpc_request, render_http_request};
use yaak_models::models::Environment;
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
