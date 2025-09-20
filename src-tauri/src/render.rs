use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use yaak_http::apply_path_placeholders;
use yaak_models::models::{
    Environment, GrpcRequest, HttpRequest, HttpRequestHeader, HttpUrlParameter,
};
use yaak_models::render::make_vars_hashmap;
use yaak_templates::{TemplateCallback, parse_and_render, render_json_value_raw};

pub async fn render_template<T: TemplateCallback>(
    template: &str,
    environment_chain: Vec<Environment>,
    cb: &T,
) -> yaak_templates::error::Result<String> {
    let vars = &make_vars_hashmap(environment_chain);
    render(template, vars, cb).await
}

pub async fn render_json_value<T: TemplateCallback>(
    value: Value,
    environment_chain: Vec<Environment>,
    cb: &T,
) -> yaak_templates::error::Result<Value> {
    let vars = &make_vars_hashmap(environment_chain);
    render_json_value_raw(value, vars, cb).await
}

pub async fn render_grpc_request<T: TemplateCallback>(
    r: &GrpcRequest,
    environment_chain: Vec<Environment>,
    cb: &T,
) -> yaak_templates::error::Result<GrpcRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut metadata = Vec::new();
    for p in r.metadata.clone() {
        metadata.push(HttpRequestHeader {
            enabled: p.enabled,
            name: render(p.name.as_str(), vars, cb).await?,
            value: render(p.value.as_str(), vars, cb).await?,
            id: p.id,
        })
    }

    let mut authentication = BTreeMap::new();
    for (k, v) in r.authentication.clone() {
        authentication.insert(k, render_json_value_raw(v, vars, cb).await?);
    }

    let url = render(r.url.as_str(), vars, cb).await?;

    Ok(GrpcRequest {
        url,
        metadata,
        authentication,
        ..r.to_owned()
    })
}

pub async fn render_http_request<T: TemplateCallback>(
    r: &HttpRequest,
    environment_chain: Vec<Environment>,
    cb: &T,
) -> yaak_templates::error::Result<HttpRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut url_parameters = Vec::new();
    for p in r.url_parameters.clone() {
        url_parameters.push(HttpUrlParameter {
            enabled: p.enabled,
            name: render(p.name.as_str(), vars, cb).await?,
            value: render(p.value.as_str(), vars, cb).await?,
            id: p.id,
        })
    }

    let mut headers = Vec::new();
    for p in r.headers.clone() {
        headers.push(HttpRequestHeader {
            enabled: p.enabled,
            name: render(p.name.as_str(), vars, cb).await?,
            value: render(p.value.as_str(), vars, cb).await?,
            id: p.id,
        })
    }

    let mut body = BTreeMap::new();
    for (k, v) in r.body.clone() {
        body.insert(k, render_json_value_raw(v, vars, cb).await?);
    }

    let mut authentication = BTreeMap::new();
    for (k, v) in r.authentication.clone() {
        authentication.insert(k, render_json_value_raw(v, vars, cb).await?);
    }

    let url = render(r.url.clone().as_str(), vars, cb).await?;

    // This doesn't fit perfectly with the concept of "rendering" but it kind of does
    let (url, url_parameters) = apply_path_placeholders(&url, url_parameters);

    Ok(HttpRequest {
        url,
        url_parameters,
        headers,
        body,
        authentication,
        ..r.to_owned()
    })
}

pub async fn render<T: TemplateCallback>(
    template: &str,
    vars: &HashMap<String, String>,
    cb: &T,
) -> yaak_templates::error::Result<String> {
    parse_and_render(template, vars, cb).await
}
