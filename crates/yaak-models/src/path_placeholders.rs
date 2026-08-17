use crate::models::HttpUrlParameter;

pub fn apply_path_placeholders(
    url: &str,
    parameters: &Vec<HttpUrlParameter>,
) -> (String, Vec<HttpUrlParameter>) {
    let mut new_parameters = Vec::new();

    let mut url = url.to_string();
    for p in parameters {
        if !p.enabled || p.name.is_empty() {
            continue;
        }

        // Replace path parameters with values from URL parameters
        let old_url_string = url.clone();
        url = replace_path_placeholder(&p, url.as_str());

        // Remove as param if it modified the URL
        if old_url_string == *url {
            new_parameters.push(p.to_owned());
        }
    }

    (url, new_parameters)
}

fn replace_path_placeholder(p: &HttpUrlParameter, url: &str) -> String {
    if !p.enabled {
        return url.to_string();
    }

    if !p.name.starts_with(":") {
        return url.to_string();
    }

    // A placeholder is `/` followed by the parameter's name (which starts with `:`), and it
    // ends at `/`, `?`, `#`, a literal `:`, or the end of the URL. The `:` boundary is what
    // lets `/:id:increment-importance` substitute the `:id` placeholder while leaving
    // `:increment-importance` as literal text. `/:foooo` is not a match for `:foo`.
    //
    // A plain scan rather than a regex: the name is matched literally, so a name containing
    // `.` or `+` means exactly that, and nothing else in the model layer needs a regex engine.
    let name = p.name.as_str();
    let value = urlencoding::encode(p.value.as_str());
    let mut result = String::with_capacity(url.len());
    let mut rest = url;
    while let Some(slash) = rest.find('/') {
        let after_slash = &rest[slash + 1..];
        let is_placeholder = after_slash.starts_with(name)
            && after_slash[name.len()..]
                .chars()
                .next()
                .is_none_or(|c| matches!(c, '/' | '?' | '#' | ':'));
        if is_placeholder {
            result.push_str(&rest[..=slash]);
            result.push_str(&value);
            rest = &after_slash[name.len()..];
        } else {
            result.push_str(&rest[..=slash]);
            rest = after_slash;
        }
    }
    result.push_str(rest);
    result
}

#[cfg(test)]
mod placeholder_tests {
    use crate::models::{HttpRequest, HttpUrlParameter};
    use crate::path_placeholders::{apply_path_placeholders, replace_path_placeholder};

    #[test]
    fn placeholder_middle() {
        let p =
            HttpUrlParameter { name: ":foo".into(), value: "xxx".into(), enabled: true, id: None };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo/bar"),
            "https://example.com/xxx/bar",
        );
    }

    #[test]
    fn placeholder_end() {
        let p =
            HttpUrlParameter { name: ":foo".into(), value: "xxx".into(), enabled: true, id: None };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo"),
            "https://example.com/xxx",
        );
    }

    #[test]
    fn placeholder_query() {
        let p =
            HttpUrlParameter { name: ":foo".into(), value: "xxx".into(), enabled: true, id: None };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo?:foo"),
            "https://example.com/xxx?:foo",
        );
    }

    #[test]
    fn placeholder_followed_by_literal_colon() {
        // AIP-136-style custom method: `:id` is the placeholder, `:increment-importance`
        // is literal text in the same path segment.
        let p =
            HttpUrlParameter { name: ":id".into(), value: "42".into(), enabled: true, id: None };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/tasks/:id:increment-importance"),
            "https://example.com/tasks/42:increment-importance",
        );
    }

    #[test]
    fn placeholder_name_is_matched_literally() {
        // `.` in a name is a dot, not "any character".
        let p = HttpUrlParameter {
            name: ":id.v2".into(),
            value: "xxx".into(),
            enabled: true,
            id: None,
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:id.v2/:idXv2"),
            "https://example.com/xxx/:idXv2",
        );
    }

    #[test]
    fn placeholder_repeated() {
        let p = HttpUrlParameter { name: ":id".into(), value: "7".into(), enabled: true, id: None };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:id/:id"),
            "https://example.com/7/7",
        );
    }

    #[test]
    fn placeholder_missing() {
        let p = HttpUrlParameter {
            enabled: true,
            name: "".to_string(),
            value: "".to_string(),
            id: None,
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
            id: None,
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo"),
            "https://example.com/:foo",
        );
    }

    #[test]
    fn placeholder_prefix() {
        let p =
            HttpUrlParameter { name: ":foo".into(), value: "xxx".into(), enabled: true, id: None };
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
            id: None,
        };
        assert_eq!(
            replace_path_placeholder(&p, "https://example.com/:foo"),
            "https://example.com/Hello%20World",
        );
    }

    #[test]
    fn apply_placeholder() {
        let req = HttpRequest {
            url: "example.com/:a/bar".to_string(),
            url_parameters: vec![
                HttpUrlParameter {
                    name: "b".to_string(),
                    value: "bbb".to_string(),
                    enabled: true,
                    id: None,
                },
                HttpUrlParameter {
                    name: ":a".to_string(),
                    value: "aaa".to_string(),
                    enabled: true,
                    id: None,
                },
            ],
            ..Default::default()
        };

        let (url, url_parameters) = apply_path_placeholders(&req.url, &req.url_parameters);

        // Pattern match back to access it
        assert_eq!(url, "example.com/aaa/bar");
        assert_eq!(url_parameters.len(), 1);
        assert_eq!(url_parameters[0].name, "b");
        assert_eq!(url_parameters[0].value, "bbb");
    }
}
