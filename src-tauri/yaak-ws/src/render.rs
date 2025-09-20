use crate::error::Result;
use std::collections::BTreeMap;
use yaak_models::models::{Environment, HttpRequestHeader, WebsocketRequest};
use yaak_models::render::make_vars_hashmap;
use yaak_templates::{parse_and_render, render_json_value_raw, TemplateCallback};

pub async fn render_websocket_request<T: TemplateCallback>(
    r: &WebsocketRequest,
    environment_chain: Vec<Environment>,
    cb: &T,
) -> Result<WebsocketRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut headers = Vec::new();
    for p in r.headers.clone() {
        headers.push(HttpRequestHeader {
            enabled: p.enabled,
            name: parse_and_render(&p.name, vars, cb).await?,
            value: parse_and_render(&p.value, vars, cb).await?,
            id: p.id,
        })
    }

    let mut authentication = BTreeMap::new();
    for (k, v) in r.authentication.clone() {
        authentication.insert(k, render_json_value_raw(v, vars, cb).await?);
    }

    let url = parse_and_render(r.url.as_str(), vars, cb).await?;

    let message = parse_and_render(&r.message.clone(), vars, cb).await?;

    Ok(WebsocketRequest {
        url,
        headers,
        authentication,
        message,
        ..r.to_owned()
    })
}
