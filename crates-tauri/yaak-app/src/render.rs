use log::info;
use serde_json::Value;
use std::collections::BTreeMap;
use yaak_http::path_placeholders::apply_path_placeholders;
use yaak_models::models::{
    Environment, GrpcRequest, HttpRequest, HttpRequestHeader, HttpUrlParameter,
};
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

pub async fn render_http_request<T: TemplateCallback>(
    r: &HttpRequest,
    environment_chain: Vec<Environment>,
    cb: &T,
    opt: &RenderOptions,
) -> yaak_templates::error::Result<HttpRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut url_parameters = Vec::new();
    for p in r.url_parameters.clone() {
        if !p.enabled {
            continue;
        }
        url_parameters.push(HttpUrlParameter {
            enabled: p.enabled,
            name: parse_and_render(p.name.as_str(), vars, cb, &opt).await?,
            value: parse_and_render(p.value.as_str(), vars, cb, &opt).await?,
            id: p.id,
        })
    }

    let mut headers = Vec::new();
    for p in r.headers.clone() {
        if !p.enabled {
            continue;
        }
        headers.push(HttpRequestHeader {
            enabled: p.enabled,
            name: parse_and_render(p.name.as_str(), vars, cb, &opt).await?,
            value: parse_and_render(p.value.as_str(), vars, cb, &opt).await?,
            id: p.id,
        })
    }

    let mut body = BTreeMap::new();
    for (k, v) in r.body.clone() {
        let v = if k == "form" { strip_disabled_form_entries(v) } else { v };
        body.insert(k, render_json_value_raw(v, vars, cb, &opt).await?);
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

    let url = parse_and_render(r.url.clone().as_str(), vars, cb, &opt).await?;

    // This doesn't fit perfectly with the concept of "rendering" but it kind of does
    let (url, url_parameters) = apply_path_placeholders(&url, &url_parameters);

    Ok(HttpRequest { url, url_parameters, headers, body, authentication, ..r.to_owned() })
}

/// Strip disabled entries from a JSON array of form objects.
fn strip_disabled_form_entries(v: Value) -> Value {
    match v {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .filter(|item| item.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true))
                .collect(),
        ),
        v => v,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_strip_disabled_form_entries() {
        let input = json!([
            {"enabled": true, "name": "foo", "value": "bar"},
            {"enabled": false, "name": "disabled", "value": "gone"},
            {"enabled": true, "name": "baz", "value": "qux"},
        ]);
        let result = strip_disabled_form_entries(input);
        assert_eq!(
            result,
            json!([
                {"enabled": true, "name": "foo", "value": "bar"},
                {"enabled": true, "name": "baz", "value": "qux"},
            ])
        );
    }

    #[test]
    fn test_strip_disabled_form_entries_all_disabled() {
        let input = json!([
            {"enabled": false, "name": "a", "value": "b"},
            {"enabled": false, "name": "c", "value": "d"},
        ]);
        let result = strip_disabled_form_entries(input);
        assert_eq!(result, json!([]));
    }

    #[test]
    fn test_strip_disabled_form_entries_missing_enabled_defaults_to_kept() {
        let input = json!([
            {"name": "no_enabled_field", "value": "kept"},
            {"enabled": false, "name": "disabled", "value": "gone"},
        ]);
        let result = strip_disabled_form_entries(input);
        assert_eq!(
            result,
            json!([
                {"name": "no_enabled_field", "value": "kept"},
            ])
        );
    }

    #[test]
    fn test_strip_disabled_form_entries_non_array_passthrough() {
        let input = json!("just a string");
        let result = strip_disabled_form_entries(input.clone());
        assert_eq!(result, input);
    }
}
