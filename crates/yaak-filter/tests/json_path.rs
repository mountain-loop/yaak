//! Ported from the `@yaak/filter-jsonpath` plugin's tests.

use serde_json::{Value, json};
use yaak_filter::{FilterResult, Language, filter, json_path};

fn matches(json: &Value, path: &str) -> Value {
    let result = json_path(&json.to_string(), path);
    assert_eq!(result.error, None, "{path}");
    serde_json::from_str(&result.content).unwrap()
}

/// The path the response breadcrumb builds for a key (`segmentsToJsonPath` in the client).
fn crumb(key: &str) -> String {
    let bare = key != "$"
        && key.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if bare { format!(".{key}") } else { format!("[{}]", serde_json::to_string(key).unwrap()) }
}

#[test]
fn breadcrumb_selects_the_literal_key_not_an_operator_or_expression() {
    let keys = [
        "identifier",
        "a.b",
        "space key",
        "",
        "quote\"key",
        "single'key",
        "back\\slash",
        "bracket]key",
        "combined\"\\]'key",
        "*",
        "..",
        "$",
        "$foo",
        "^",
        "~",
        "a,b",
        "0:2",
        "?(true)",
        "(@.length-1)",
        "@number()",
        "`key",
        "x)]y",
        "x)']y",
        "semi;colon",
        "percent%@%key",
        "line\nbreak\t\u{0}",
        "emoji 🤔",
        "__proto__",
        "constructor",
    ];
    for key in keys {
        let mut object = serde_json::Map::new();
        object.insert(key.to_string(), json!("needle-value"));
        object.insert("decoy".to_string(), json!("wrong-value"));
        let path = format!("${}", crumb(key));
        assert_eq!(matches(&Value::Object(object), &path), json!(["needle-value"]), "{key:?}");
    }
}

#[test]
fn nested_unusual_keys_and_arrays_filter_at_every_crumb() {
    let inner = json!({ "inner'\\]": { "": "needle-value" } });
    let json = json!({ "outer": { "quote\"key": ["decoy", inner] } });
    let crumbs = [
        crumb("outer"),
        crumb("quote\"key"),
        "[1]".to_string(),
        crumb("inner'\\]"),
        crumb(""),
    ];
    let path = |count: usize| format!("${}", crumbs[..count].concat());

    assert_eq!(matches(&json, &path(5)), json!(["needle-value"]));
    assert_eq!(matches(&json, &path(4)), json!([{ "": "needle-value" }]));
    assert_eq!(matches(&json, &path(3)), json!([inner]));
    assert_eq!(matches(&json, &path(2)), json!([["decoy", inner]]));
    assert_eq!(matches(&json, &path(1)), json!([json["outer"]]));
    assert_eq!(matches(&json, &path(0)), json!([json]));
}

#[test]
fn root_arrays_and_quoted_numeric_object_keys_remain_distinct() {
    let json = json!(["decoy", { "01": { "1": "needle-value" } }]);
    assert_eq!(matches(&json, r#"$[1]["01"]["1"]"#), json!(["needle-value"]));
    assert_eq!(matches(&json, r#"$[1]["01"]["missing"]"#), json!([]));
}

#[test]
fn retains_the_matched_value() {
    for value in [
        json!(null),
        json!(false),
        json!(0),
        json!(""),
        json!([1, 2]),
        json!({ "value": 3 }),
    ] {
        let json = json!({ "quote\"key": value });
        assert_eq!(matches(&json, r#"$["quote\"key"]"#), json!([value]));
    }
}

#[test]
fn only_follows_own_properties_while_allowing_prototype_named_keys() {
    let json: Value =
        serde_json::from_str(r#"{"a.b":{"__proto__":{"constructor":"own-value"}}}"#).unwrap();
    assert_eq!(matches(&json, r#"$["a.b"].__proto__.constructor"#), json!(["own-value"]));
    assert_eq!(matches(&json, r#"$["a.b"].constructor"#), json!([]));
    assert_eq!(matches(&json, r#"$["a.b"].__proto__.toString"#), json!([]));
    assert_eq!(matches(&json, r#"$["a.b"].__proto__.constructor.__proto__"#), json!([]));
}

#[test]
fn existing_jsonpath_expressions() {
    let json = json!({ "items": [{ "id": 1 }, { "id": 2 }, { "id": 3 }], "space key": 4 });
    let cases = [
        ("$", json!([json])),
        ("$.items[1].id", json!([2])),
        (r#"$["space key"]"#, json!([4])),
        ("$['space key']", json!([4])),
        ("$.items[*].id", json!([1, 2, 3])),
        ("$..id", json!([1, 2, 3])),
        ("$.items[0:2].id", json!([1, 2])),
        ("$.items[0,2].id", json!([1, 3])),
        ("$.items[-1].id", json!([3])),
        ("$.items[?(@.id > 1)].id", json!([2, 3])),
        ("$.items[?@.id > 1].id", json!([2, 3])),
        (r#"$.items[?(@["id"] > 1)].id"#, json!([2, 3])),
        (r#"$["items"][*].id"#, json!([1, 2, 3])),
        ("$.items[?length(@) == 1].id", json!([1, 2, 3])),
        ("$.missing", json!([])),
    ];
    for (path, expected) in cases {
        assert_eq!(matches(&json, path), expected, "{path}");
    }
}

fn error(json: &Value, path: &str) -> String {
    let result = json_path(&json.to_string(), path);
    assert_eq!(result.content, "", "{path}");
    let error = result.error.unwrap_or_else(|| panic!("{path} should fail"));
    assert!(error.starts_with("Invalid filter: "), "{path}: {error}");
    error
}

#[test]
fn jsonpath_plus_extensions_work() {
    let json = json!({ "items": [{ "id": 1 }, { "id": 2 }, { "id": 3 }], "space key": 4 });
    let cases = [
        ("$.items[(@.length-1)].id", json!([3])),
        (r#"$["items"].$"#, json!([json["items"]])),
        ("$.items[?(@.id.toString() == '1')]", json!([{ "id": 1 }])),
        ("$.items[?(@property == 1)].id", json!([2])),
        ("$.items[?(@.id > 1)]^", json!([json["items"], json["items"]])),
        ("$.items[*]~", json!([0, 1, 2])),
        ("$..*@number()", json!([4, 1, 2, 3])),
        ("$.items[?(@.id == '2')].id", json!([2])),
        ("$.items[?(/^[13]$/.test(@.id))].id", json!([1, 3])),
        ("$.`space key", json!([4])),
    ];
    for (path, expected) in cases {
        assert_eq!(matches(&json, path), expected, "{path}");
    }
}

#[test]
fn calls_outside_the_allowlist_and_statements_are_errors() {
    let json = json!({ "items": [{ "id": 1, "name": "a" }], "none": [] });
    for (path, named) in [
        ("$.items[?(@.name.padStart(2) == ' a')]", "padStart"),
        ("$.items[?(@.name['padStart'](2) == ' a')]", "padStart"),
        ("$.items[?(@.hasOwnProperty('id'))]", "hasOwnProperty"),
        ("$.items[?(@.id; true)]", "multiple expressions"),
        ("$.items[?(var x = 1; x)]", "var"),
        ("$.items[?(@.id = 2)]", "assignment"),
        ("$.items[?(@.id++)]", "++"),
        ("$.items[?(@.id ** 2)]", "**"),
        ("$.items[?(foo(@.id))]", "foo()"),
    ] {
        let message = error(&json, path);
        assert!(message.contains(named), "{path}: {message}");
    }
}

#[test]
fn deviation_eager_parse_rejects_filters_no_node_reaches() {
    let json = json!({ "none": [] });
    assert!(error(&json, "$.none[?(@.a ==)]").contains("Expected expression"));
    assert!(error(&json, "$.none[?(@.a.padStart(1))]").contains("padStart"));
}

#[test]
fn deviation_rfc_negative_index_and_step() {
    let json = json!({ "a": [0, 1, 2, 3] });
    assert_eq!(matches(&json, "$.a[-1]"), json!([3]));
    assert_eq!(matches(&json, "$.a[-5]"), json!([]));
    assert_eq!(matches(&json, "$.a[::-1]"), json!([3, 2, 1, 0]));
    assert_eq!(matches(&json, "$.a[3:0:-2]"), json!([3, 1]));
    // Parts of a union keep jsonpath-plus's reading, so its non-empty results stand.
    assert_eq!(matches(&json, "$.a[0,-1]"), json!([0]));
}

#[test]
fn deviation_rfc_filter_without_parentheses() {
    let json = json!({ "a": [{ "x": 1 }, { "x": 0 }, { "y": 2 }] });
    assert_eq!(matches(&json, "$.a[?@.x]"), json!([{ "x": 1 }, { "x": 0 }]));
    assert_eq!(matches(&json, "$.a[?@.x == '1']"), json!([]));
    assert_eq!(matches(&json, "$.a[?@.x < 1 || @.y]"), json!([{ "x": 0 }, { "y": 2 }]));
    assert!(error(&json, "$.a[?@.* == 1]").contains("cannot be compared"));
}

#[test]
fn deviation_rfc_functions() {
    let json = json!({ "a": [{ "n": "ab", "t": [1, 2] }, { "n": "b", "t": [] }] });
    assert_eq!(matches(&json, "$.a[?length(@.n) == 2].n"), json!(["ab"]));
    assert_eq!(matches(&json, "$.a[?(count(@.t[*]) == 0)].n"), json!(["b"]));
    assert_eq!(matches(&json, "$.a[?match(@.n, 'a.')].n"), json!(["ab"]));
    assert_eq!(matches(&json, "$.a[?(search(@.n, 'b'))].n"), json!(["ab", "b"]));
    assert_eq!(matches(&json, "$.a[?value(@.t[0]) == 1].n"), json!(["ab"]));
    assert!(error(&json, "$.a[?length(@.n)]").contains("compare it"));
}

#[test]
fn deviation_falsy_root_is_a_document() {
    for root in ["0", "\"\"", "false", "null"] {
        assert_eq!(json_path(root, "$").content, format!("[\n  {root}\n]"), "{root}");
    }
}

#[test]
fn deviation_lone_surrogate_becomes_replacement_character() {
    assert_eq!(matches(&json!({ "s": "🤔" }), "$.s[0]"), json!(["\u{fffd}"]));
}

#[test]
fn integer_like_keys_come_first_as_in_javascript() {
    let result = json_path(r#"{"b":1,"10":2,"a":3,"2":4}"#, "$.*~");
    assert_eq!(result.content, "[\n  \"2\",\n  \"10\",\n  \"b\",\n  \"a\"\n]");
}

#[test]
fn output_is_pretty_printed_and_keeps_key_order() {
    let result = json_path(r#"{"b":{"z":1,"a":[true,null]}}"#, "$.b");
    assert_eq!(
        result,
        FilterResult {
            content: "[\n  {\n    \"z\": 1,\n    \"a\": [\n      true,\n      null\n    ]\n  }\n]"
                .to_string(),
            error: None,
        }
    );
}

#[test]
fn invalid_json_is_an_error() {
    let result = json_path("{not json", "$");
    assert_eq!(result.content, "");
    assert!(result.error.unwrap().starts_with("Invalid JSON: "));
}

#[test]
fn content_type_picks_the_language() {
    assert_eq!(Language::for_content_type("application/json"), Language::JsonPath);
    assert_eq!(Language::for_content_type("text/plain"), Language::JsonPath);
    assert_eq!(Language::for_content_type(""), Language::JsonPath);
    assert_eq!(Language::for_content_type("application/xml"), Language::XPath);
    assert_eq!(Language::for_content_type("application/rss+XML"), Language::XPath);
    assert_eq!(Language::for_content_type("text/html; charset=utf-8"), Language::XPath);
    assert_eq!(filter(Language::JsonPath, "[1]", "$[0]").content, "[\n  1\n]");
}

#[test]
fn comparing_an_array_to_an_object_is_false() {
    let result = json_path(r#"[{"a":[],"b":{}},{"a":[1],"b":[1]}]"#, "$[?@.a == @.b].a");
    assert_eq!(result.content, "[\n  [\n    1\n  ]\n]");
}

#[test]
fn invalid_escape_before_a_multibyte_character_is_an_error() {
    let result = json_path("{\"a\":\"\\é\"}", "$");
    assert!(result.error.unwrap().starts_with("Invalid JSON: "));
}

#[test]
fn deeply_nested_filters_are_errors() {
    let nested = |open: &str, inner: &str, close: &str| {
        format!("{}{inner}{}", open.repeat(5000), close.repeat(5000))
    };
    for query in [
        format!("$[?{} == 1]", nested("length(", "@", ")")),
        format!("$[?{}]", nested("(", "@", ")")),
        format!("$[?({} == 1)]", nested("(", "@", ")")),
        nested("$[?@", "", "]"),
    ] {
        let result = json_path("[[1]]", &query);
        assert!(result.error.unwrap().starts_with("Invalid filter: "), "{}", &query[..20]);
    }
}
