use log::info;
use serde_json::Value;
use std::collections::BTreeMap;
use yaak_http::path_placeholders::apply_path_placeholders;
use yaak_models::models::{Environment, HttpRequest, HttpRequestHeader, HttpUrlParameter};
use yaak_models::render::make_vars_hashmap;
use yaak_templates::{RenderOptions, TemplateCallback, parse_and_render, render_json_value_raw};

pub async fn render_http_request<T: TemplateCallback>(
    request: &HttpRequest,
    environment_chain: Vec<Environment>,
    callback: &T,
    options: &RenderOptions,
) -> yaak_templates::error::Result<HttpRequest> {
    let vars = &make_vars_hashmap(environment_chain);

    let mut url_parameters = Vec::new();
    for parameter in request.url_parameters.clone() {
        if !parameter.enabled {
            continue;
        }

        url_parameters.push(HttpUrlParameter {
            enabled: parameter.enabled,
            name: parse_and_render(parameter.name.as_str(), vars, callback, options).await?,
            value: parse_and_render(parameter.value.as_str(), vars, callback, options).await?,
            id: parameter.id,
        })
    }

    let mut headers = Vec::new();
    for header in request.headers.clone() {
        if !header.enabled {
            continue;
        }

        headers.push(HttpRequestHeader {
            enabled: header.enabled,
            name: parse_and_render(header.name.as_str(), vars, callback, options).await?,
            value: parse_and_render(header.value.as_str(), vars, callback, options).await?,
            id: header.id,
        })
    }

    let mut body = BTreeMap::new();
    for (key, value) in request.body.clone() {
        let value = if key == "form" { strip_disabled_form_entries(value) } else { value };
        body.insert(key, render_json_value_raw(value, vars, callback, options).await?);
    }

    let authentication = {
        let mut disabled = false;
        let mut auth = BTreeMap::new();

        match request.authentication.get("disabled") {
            Some(Value::Bool(true)) => {
                disabled = true;
            }
            Some(Value::String(template)) => {
                disabled = parse_and_render(template.as_str(), vars, callback, options)
                    .await
                    .unwrap_or_default()
                    .is_empty();
                info!(
                    "Rendering authentication.disabled as a template: {disabled} from \"{template}\""
                );
            }
            _ => {}
        }

        if disabled {
            auth.insert("disabled".to_string(), Value::Bool(true));
        } else {
            for (key, value) in request.authentication.clone() {
                if key == "disabled" {
                    auth.insert(key, Value::Bool(false));
                } else {
                    auth.insert(key, render_json_value_raw(value, vars, callback, options).await?);
                }
            }
        }

        auth
    };

    let url = parse_and_render(request.url.clone().as_str(), vars, callback, options).await?;
    let (url, url_parameters) = apply_path_placeholders(&url, &url_parameters);

    Ok(HttpRequest { url, url_parameters, headers, body, authentication, ..request.to_owned() })
}

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
