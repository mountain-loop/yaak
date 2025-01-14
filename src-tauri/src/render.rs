use crate::template_callback::PluginTemplateCallback;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use yaak_models::models::{
    Environment, EnvironmentVariable, GrpcMetadataEntry, GrpcRequest, HttpRequest,
    HttpRequestHeader, HttpUrlParameter,
};
use yaak_templates::{parse_and_render, TemplateCallback};

pub async fn render_template<T: TemplateCallback>(
    template: &str,
    base_environment: &Environment,
    environment: Option<&Environment>,
    cb: &T,
) -> String {
    let vars = &make_vars_hashmap(base_environment, environment);
    render(template, vars, cb).await
}

pub async fn render_json_value<T: TemplateCallback>(
    value: Value,
    base_environment: &Environment,
    environment: Option<&Environment>,
    cb: &T,
) -> Value {
    let vars = &make_vars_hashmap(base_environment, environment);
    render_json_value_raw(value, vars, cb).await
}

pub async fn render_grpc_request<T: TemplateCallback>(
    r: &GrpcRequest,
    base_environment: &Environment,
    environment: Option<&Environment>,
    cb: &T,
) -> GrpcRequest {
    let vars = &make_vars_hashmap(base_environment, environment);

    let mut metadata = Vec::new();
    for p in r.metadata.clone() {
        metadata.push(GrpcMetadataEntry {
            enabled: p.enabled,
            name: render(p.name.as_str(), vars, cb).await,
            value: render(p.value.as_str(), vars, cb).await,
            id: p.id,
        })
    }

    let mut authentication = BTreeMap::new();
    for (k, v) in r.authentication.clone() {
        authentication.insert(k, render_json_value_raw(v, vars, cb).await);
    }

    let url = render(r.url.as_str(), vars, cb).await;

    GrpcRequest {
        url,
        metadata,
        authentication,
        ..r.to_owned()
    }
}

pub async fn render_http_request(
    r: &HttpRequest,
    base_environment: &Environment,
    environment: Option<&Environment>,
    cb: &PluginTemplateCallback,
) -> HttpRequest {
    let vars = &make_vars_hashmap(base_environment, environment);

    let mut url_parameters = Vec::new();
    for p in r.url_parameters.clone() {
        url_parameters.push(HttpUrlParameter {
            enabled: p.enabled,
            name: render(p.name.as_str(), vars, cb).await,
            value: render(p.value.as_str(), vars, cb).await,
            id: p.id,
        })
    }

    let mut headers = Vec::new();
    for p in r.headers.clone() {
        headers.push(HttpRequestHeader {
            enabled: p.enabled,
            name: render(p.name.as_str(), vars, cb).await,
            value: render(p.value.as_str(), vars, cb).await,
            id: p.id,
        })
    }

    let mut body = BTreeMap::new();
    for (k, v) in r.body.clone() {
        body.insert(k, render_json_value_raw(v, vars, cb).await);
    }

    let mut authentication = BTreeMap::new();
    for (k, v) in r.authentication.clone() {
        authentication.insert(k, render_json_value_raw(v, vars, cb).await);
    }

    let url = render(r.url.clone().as_str(), vars, cb).await;
    let req = HttpRequest {
        url,
        url_parameters,
        headers,
        body,
        authentication,
        ..r.to_owned()
    };

    // This doesn't fit perfectly with the concept of "rendering" but it kind of does
    apply_path_placeholders(req)
}

pub fn make_vars_hashmap(
    base_environment: &Environment,
    environment: Option<&Environment>,
) -> HashMap<String, String> {
    let mut variables = HashMap::new();
    variables = add_variable_to_map(variables, &base_environment.variables);

    if let Some(e) = environment {
        variables = add_variable_to_map(variables, &e.variables);
    }

    variables
}

pub async fn render<T: TemplateCallback>(
    template: &str,
    vars: &HashMap<String, String>,
    cb: &T,
) -> String {
    parse_and_render(template, vars, cb).await
}

fn add_variable_to_map(
    m: HashMap<String, String>,
    variables: &Vec<EnvironmentVariable>,
) -> HashMap<String, String> {
    let mut map = m.clone();
    for variable in variables {
        if !variable.enabled || variable.value.is_empty() {
            continue;
        }
        let name = variable.name.as_str();
        let value = variable.value.as_str();
        map.insert(name.into(), value.into());
    }

    map
}

async fn render_json_value_raw<T: TemplateCallback>(
    v: Value,
    vars: &HashMap<String, String>,
    cb: &T,
) -> Value {
    match v {
        Value::String(s) => json!(render(s.as_str(), vars, cb).await),
        Value::Array(a) => {
            let mut new_a = Vec::new();
            for v in a {
                new_a.push(Box::pin(render_json_value_raw(v, vars, cb)).await)
            }
            json!(new_a)
        }
        Value::Object(o) => {
            let mut new_o = Map::new();
            for (k, v) in o {
                let key = Box::pin(render(k.as_str(), vars, cb)).await;
                let value = Box::pin(render_json_value_raw(v, vars, cb)).await;
                new_o.insert(key, value);
            }
            json!(new_o)
        }
        v => v,
    }
}

#[cfg(test)]
mod render_tests {
    use serde_json::json;
    use std::collections::HashMap;
    use yaak_templates::TemplateCallback;

    struct EmptyCB {}

    impl TemplateCallback for EmptyCB {
        async fn run(
            &self,
            _fn_name: &str,
            _args: HashMap<String, String>,
        ) -> Result<String, String> {
            todo!()
        }
    }

    #[tokio::test]
    async fn render_json_value_string() {
        let v = json!("${[a]}");
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());

        let result = super::render_json_value_raw(v, &vars, &EmptyCB {}).await;
        assert_eq!(result, json!("aaa"))
    }

    #[tokio::test]
    async fn render_json_value_array() {
        let v = json!(["${[a]}", "${[a]}"]);
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());

        let result = super::render_json_value_raw(v, &vars, &EmptyCB {}).await;
        assert_eq!(result, json!(["aaa", "aaa"]))
    }

    #[tokio::test]
    async fn render_json_value_object() {
        let v = json!({"${[a]}": "${[a]}"});
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());

        let result = super::render_json_value_raw(v, &vars, &EmptyCB {}).await;
        assert_eq!(result, json!({"aaa": "aaa"}))
    }

    #[tokio::test]
    async fn render_json_value_nested() {
        let v = json!([
            123,
            {"${[a]}": "${[a]}"},
            null,
            "${[a]}",
            false,
            {"x": ["${[a]}"]}
        ]);
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());

        let result = super::render_json_value_raw(v, &vars, &EmptyCB {}).await;
        assert_eq!(
            result,
            json!([
                123,
                {"aaa": "aaa"},
                null,
                "aaa",
                false,
                {"x": ["aaa"]}
            ])
        )
    }
}

fn replace_path_placeholder(p: &HttpUrlParameter, url: &str) -> String {
    if !p.enabled {
        return url.to_string();
    }

    if !p.name.starts_with(":") {
        return url.to_string();
    }

    let re = regex::Regex::new(format!("(/){}([/?#]|$)", p.name).as_str()).unwrap();
    let result = re
        .replace_all(url, |cap: &regex::Captures| {
            format!(
                "{}{}{}",
                cap[1].to_string(),
                urlencoding::encode(p.value.as_str()),
                cap[2].to_string()
            )
        })
        .into_owned();
    result
}

fn apply_path_placeholders(rendered_request: HttpRequest) -> HttpRequest {
    let mut url = rendered_request.url.to_owned();
    let mut url_parameters = Vec::new();
    for p in rendered_request.url_parameters.clone() {
        if !p.enabled || p.name.is_empty() {
            continue;
        }

        // Replace path parameters with values from URL parameters
        let old_url_string = url.clone();
        url = replace_path_placeholder(&p, url.as_str());

        // Remove as param if it modified the URL
        if old_url_string == url {
            url_parameters.push(p);
        }
    }

    let mut request = rendered_request.clone();
    request.url_parameters = url_parameters;
    request.url = url;
    request
}

#[cfg(test)]
mod placeholder_tests {
    use crate::render::{apply_path_placeholders, replace_path_placeholder};
    use yaak_models::models::{HttpRequest, HttpUrlParameter};

    #[test]
    fn placeholder_middle() {
        let p = HttpUrlParameter {
            name: ":foo".into(),
            value: "xxx".into(),
            enabled: true,
            id: "p1".into(),
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo/bar"),
            "https://example.com/xxx/bar",
        );
    }

    #[test]
    fn placeholder_end() {
        let p = HttpUrlParameter {
            name: ":foo".into(),
            value: "xxx".into(),
            enabled: true,
            id: "p1".into(),
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo"),
            "https://example.com/xxx",
        );
    }

    #[test]
    fn placeholder_query() {
        let p = HttpUrlParameter {
            name: ":foo".into(),
            value: "xxx".into(),
            enabled: true,
            id: "p1".into(),
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo?:foo"),
            "https://example.com/xxx?:foo",
        );
    }

    #[test]
    fn placeholder_missing() {
        let p = HttpUrlParameter {
            enabled: true,
            name: "".to_string(),
            value: "".to_string(),
            id: "p1".into(),
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:missing"),
            "https://example.com/:missing",
        );
    }

    #[test]
    fn placeholder_disabled() {
        let p = HttpUrlParameter {
            enabled: false,
            name: ":foo".to_string(),
            value: "xxx".to_string(),
            id: "p1".into(),
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo"),
            "https://example.com/:foo",
        );
    }

    #[test]
    fn placeholder_prefix() {
        let p = HttpUrlParameter {
            name: ":foo".into(),
            value: "xxx".into(),
            enabled: true,
            id: "p1".into(),
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foooo"),
            "https://example.com/:foooo",
        );
    }

    #[test]
    fn placeholder_encode() {
        let p = HttpUrlParameter {
            name: ":foo".into(),
            value: "Hello World".into(),
            enabled: true,
            id: "p1".into(),
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo"),
            "https://example.com/Hello%20World",
        );
    }

    #[test]
    fn apply_placeholder() {
        let result = apply_path_placeholders(HttpRequest {
            url: "example.com/:a/bar".to_string(),
            url_parameters: vec![
                HttpUrlParameter {
                    name: "b".to_string(),
                    value: "bbb".to_string(),
                    enabled: true,
                    id: "p1".into(),
                },
                HttpUrlParameter {
                    name: ":a".to_string(),
                    value: "aaa".to_string(),
                    enabled: true,
                    id: "p2".into(),
                },
            ],
            ..Default::default()
        });
        assert_eq!(result.url, "example.com/aaa/bar");
        assert_eq!(result.url_parameters.len(), 1);
        assert_eq!(result.url_parameters[0].name, "b");
        assert_eq!(result.url_parameters[0].value, "bbb");
    }
}
