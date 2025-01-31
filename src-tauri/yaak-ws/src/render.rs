use std::collections::BTreeMap;
use yaak_models::models::{Environment, HttpRequestHeader, WebsocketMessageType, WebsocketRequest};
use yaak_models::render::make_vars_hashmap;
use yaak_templates::{parse_and_render, render_json_value_raw, TemplateCallback};

pub async fn render_request<T: TemplateCallback>(
    r: &WebsocketRequest,
    base_environment: &Environment,
    environment: Option<&Environment>,
    cb: &T,
) -> WebsocketRequest {
    let vars = &make_vars_hashmap(base_environment, environment);

    let mut headers = Vec::new();
    for p in r.headers.clone() {
        headers.push(HttpRequestHeader {
            enabled: p.enabled,
            name: parse_and_render(&p.name, vars, cb).await,
            value: parse_and_render(&p.value, vars, cb).await,
            id: p.id,
        })
    }

    let mut authentication = BTreeMap::new();
    for (k, v) in r.authentication.clone() {
        authentication.insert(k, render_json_value_raw(v, vars, cb).await);
    }

    let url = parse_and_render(r.url.as_str(), vars, cb).await;
    
    let message: Vec<u8> = match r.message_type {
        WebsocketMessageType::Text => {
            parse_and_render(&String::from_utf8(r.message.clone()).unwrap_or_default(), vars, cb)
                .await
                .into_bytes()
        }
        WebsocketMessageType::Binary => r.message.clone(),
    };

    WebsocketRequest {
        url,
        headers,
        authentication,
        message,
        ..r.to_owned()
    }
}
