//! Runs a parsed query against one document in memory.

use crate::ast::{FieldValue, Node};
use crate::fuzzy::fuzzy_match;
use crate::schema::{FieldKind, FreeText, ResolvedField, Schema, parse_flag, to_base};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// What a query is matched against: free text for bare words and phrases, and field values by
/// lowercase dotted path. A map field's values sit under `name.key` (`header.x-cache`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct Document {
    #[serde(default)]
    #[cfg_attr(test, ts(optional, as = "Option<String>"))]
    pub text: String,
    #[serde(default)]
    #[cfg_attr(test, ts(optional, as = "Option<HashMap<String, DocValues>>"))]
    pub fields: HashMap<String, DocValues>,
}

/// One value or several.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum DocValues {
    One(DocValue),
    Many(Vec<DocValue>),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum DocValue {
    Flag(bool),
    Number(f64),
    Text(String),
}

impl Document {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into(), fields: HashMap::new() }
    }

    /// Adds a value under `path`, keeping any already there.
    pub fn with(mut self, path: &str, value: impl Into<DocValue>) -> Self {
        let value = value.into();
        let path = path.to_lowercase();
        match self.fields.remove(&path) {
            None => self.fields.insert(path, DocValues::One(value)),
            Some(DocValues::One(first)) => {
                self.fields.insert(path, DocValues::Many(vec![first, value]))
            }
            Some(DocValues::Many(mut values)) => {
                values.push(value);
                self.fields.insert(path, DocValues::Many(values))
            }
        };
        self
    }

    /// The values under `path` (lowercase), and for a map field with no key, the values of
    /// every key under it.
    fn values(&self, field: &ResolvedField) -> Vec<&DocValue> {
        let path = field.document_path();
        let mut out = Vec::new();
        for (key, values) in &self.fields {
            let key_lower = key.to_lowercase();
            let hit = key_lower == path
                || (field.def.map
                    && field.key.is_none()
                    && key_lower.strip_prefix(&path).is_some_and(|rest| rest.starts_with('.')));
            if !hit {
                continue;
            }
            match values {
                DocValues::One(v) => out.push(v),
                DocValues::Many(vs) => out.extend(vs.iter()),
            }
        }
        out
    }
}

impl From<&str> for DocValue {
    fn from(value: &str) -> Self {
        DocValue::Text(value.to_string())
    }
}

impl From<String> for DocValue {
    fn from(value: String) -> Self {
        DocValue::Text(value)
    }
}

impl From<f64> for DocValue {
    fn from(value: f64) -> Self {
        DocValue::Number(value)
    }
}

impl From<bool> for DocValue {
    fn from(value: bool) -> Self {
        DocValue::Flag(value)
    }
}

impl DocValue {
    fn as_text(&self) -> String {
        match self {
            DocValue::Text(text) => text.to_lowercase(),
            DocValue::Number(n) => format_number(*n),
            DocValue::Flag(b) => b.to_string(),
        }
    }

    fn as_number(&self) -> Option<f64> {
        match self {
            DocValue::Number(n) => Some(*n),
            DocValue::Text(text) => text.trim().parse().ok(),
            DocValue::Flag(_) => None,
        }
    }

    fn as_flag(&self) -> Option<bool> {
        match self {
            DocValue::Flag(b) => Some(*b),
            DocValue::Text(text) => parse_flag(text),
            DocValue::Number(n) => Some(*n != 0.0),
        }
    }

    fn is_present(&self) -> bool {
        match self {
            DocValue::Text(text) => !text.is_empty(),
            DocValue::Number(_) => true,
            DocValue::Flag(b) => *b,
        }
    }
}

/// `200`, not `200.0`, so a number field's text matches what the user sees.
fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 { format!("{}", n as i64) } else { n.to_string() }
}

/// Whether `doc` matches the query. `None` (an empty query) matches everything.
pub fn evaluate(root: Option<&Node>, schema: &Schema, doc: &Document) -> bool {
    let Some(root) = root else { return true };
    let text = doc.text.to_lowercase();
    eval_node(root, schema, doc, &text)
}

fn eval_node(node: &Node, schema: &Schema, doc: &Document, text: &str) -> bool {
    match node {
        Node::And { children, .. } => children.iter().all(|c| eval_node(c, schema, doc, text)),
        Node::Or { children, .. } => children.iter().any(|c| eval_node(c, schema, doc, text)),
        Node::Not { node, .. } => !eval_node(node, schema, doc, text),
        Node::Term { text: term, .. } => {
            let term = term.trim().to_lowercase();
            if term.is_empty() {
                return false;
            }
            match schema.free_text {
                FreeText::Fuzzy => fuzzy_match(text, &term),
                FreeText::Substring => text.contains(&term),
            }
        }
        Node::Phrase { text: phrase, .. } => {
            !phrase.is_empty() && text.contains(&phrase.to_lowercase())
        }
        Node::Field { path, value, .. } => {
            let Some(field) = schema.resolve(path) else {
                return false;
            };
            let values = doc.values(&field);
            match &field.def.kind {
                FieldKind::Text => match_text(&values, value),
                FieldKind::Number { units } => match_number(&values, value, units),
                FieldKind::Flag => match_flag(&values, value),
            }
        }
    }
}

fn match_text(values: &[&DocValue], value: &FieldValue) -> bool {
    match value {
        FieldValue::Text { text, .. } => {
            let needle = text.to_lowercase();
            !needle.is_empty() && values.iter().any(|v| v.as_text().contains(&needle))
        }
        FieldValue::Wildcard { pattern } => {
            let pattern = pattern.to_lowercase();
            values.iter().any(|v| wildcard_match(&pattern, &v.as_text()))
        }
        FieldValue::Exists => values.iter().any(|v| v.is_present()),
        // A text field holding numbers, such as a status shown as text
        FieldValue::Compare { op, number } => {
            number.unit.is_none()
                && values.iter().any(|v| v.as_number().is_some_and(|n| op.test(n, number.value)))
        }
        FieldValue::Range { low, high } => {
            low.unit.is_none()
                && high.unit.is_none()
                && values
                    .iter()
                    .any(|v| v.as_number().is_some_and(|n| n >= low.value && n <= high.value))
        }
    }
}

fn match_number(values: &[&DocValue], value: &FieldValue, units: &[crate::Unit]) -> bool {
    let numbers = || values.iter().filter_map(|v| v.as_number());
    match value {
        FieldValue::Text { text, quoted } => {
            if text.is_empty() {
                return false;
            }
            // `@status:404` is equality; anything else matches the number as text
            match (!quoted).then(|| crate::lexer::parse_number(text)).flatten() {
                Some(number) => {
                    to_base(&number, units).is_some_and(|target| numbers().any(|n| n == target))
                }
                None => match_text(values, value),
            }
        }
        FieldValue::Wildcard { .. } => match_text(values, value),
        FieldValue::Exists => numbers().next().is_some(),
        FieldValue::Compare { op, number } => {
            to_base(number, units).is_some_and(|target| numbers().any(|n| op.test(n, target)))
        }
        FieldValue::Range { low, high } => match (to_base(low, units), to_base(high, units)) {
            (Some(low), Some(high)) => numbers().any(|n| n >= low && n <= high),
            _ => false,
        },
    }
}

fn match_flag(values: &[&DocValue], value: &FieldValue) -> bool {
    let is_set = || values.iter().any(|v| v.as_flag() == Some(true));
    match value {
        FieldValue::Exists => is_set(),
        FieldValue::Text { text, .. } => match parse_flag(text) {
            Some(true) => is_set(),
            Some(false) => !is_set(),
            None => false,
        },
        _ => false,
    }
}

/// Whether `pattern`, where `*` matches any run of characters, matches the whole of `text`.
pub(crate) fn wildcard_match(pattern: &str, text: &str) -> bool {
    let mut parts = pattern.split('*');
    let first = parts.next().unwrap_or_default();
    let Some(mut rest) = text.strip_prefix(first) else {
        return false;
    };
    let parts: Vec<&str> = parts.collect();
    let Some((last, middle)) = parts.split_last() else {
        // No `*` at all: the whole text must equal the pattern
        return rest.is_empty();
    };
    for part in middle {
        match rest.find(part) {
            Some(i) => rest = &rest[i + part.len()..],
            None => return false,
        }
    }
    rest.len() >= last.len() && rest.ends_with(last)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{FieldDef, Unit};
    use crate::{format_field, parse};

    fn text_field(name: &str) -> FieldDef {
        FieldDef { name: name.into(), kind: FieldKind::Text, map: false, info: None }
    }

    /// The fields and free-text mode of Yaak's sidebar.
    fn sidebar() -> Schema {
        Schema::new(
            [
                "method",
                "url",
                "name",
                "type",
                "folder",
                "grpc_service",
                "grpc_method",
            ]
            .into_iter()
            .map(text_field)
            .collect(),
            FreeText::Fuzzy,
        )
    }

    fn proxy_like() -> Schema {
        Schema::new(
            vec![
                text_field("url"),
                FieldDef { name: "header".into(), kind: FieldKind::Text, map: true, info: None },
                FieldDef {
                    name: "status".into(),
                    kind: FieldKind::Number { units: vec![] },
                    map: false,
                    info: None,
                },
                FieldDef {
                    name: "duration".into(),
                    kind: FieldKind::Number {
                        units: vec![
                            Unit { name: "ms".into(), factor: 1.0 },
                            Unit { name: "s".into(), factor: 1000.0 },
                        ],
                    },
                    map: false,
                    info: None,
                },
                FieldDef { name: "error".into(), kind: FieldKind::Flag, map: false, info: None },
            ],
            FreeText::Substring,
        )
    }

    /// An HTTP request in Yaak's sidebar, built the way `getItemFields` and `getItemText` do.
    fn request(method: &str, name: &str, url: &str, folder: Option<&str>) -> Document {
        let mut doc = Document::new(format!("{method} {name}"))
            .with("method", method.to_uppercase())
            .with("url", url)
            .with("name", name)
            .with("type", "http");
        if let Some(folder) = folder {
            doc = doc.with("folder", folder);
        }
        doc
    }

    fn grpc(name: &str, service: &str, method: &str) -> Document {
        Document::new(name)
            .with("grpc_method", method)
            .with("grpc_service", service)
            .with("url", "localhost:50051")
            .with("name", name)
            .with("type", "grpc")
    }

    fn matches(query: &str, schema: &Schema, doc: &Document) -> bool {
        evaluate(parse(query).as_ref(), schema, doc)
    }

    fn sidebar_matches(query: &str, doc: &Document) -> bool {
        matches(query, &sidebar(), doc)
    }

    #[test]
    fn empty_query_matches_everything() {
        assert!(sidebar_matches("", &Document::default()));
        assert!(sidebar_matches("  ", &Document::default()));
    }

    #[test]
    fn bare_words_are_fuzzy_in_the_sidebar() {
        let doc = request("GET", "My Request", "https://yaak.app", None);
        assert!(sidebar_matches("my", &doc));
        assert!(sidebar_matches("REQ", &doc));
        assert!(sidebar_matches("mr", &doc));
        assert!(sidebar_matches("get", &doc));
        assert!(!sidebar_matches("rq", &doc));
        // Bare words match the free text only, not the URL
        assert!(!sidebar_matches("yaak", &doc));
    }

    #[test]
    fn bare_words_are_substrings_in_substring_mode() {
        let doc = Document::new("GET /v1/charges 200");
        let schema = proxy_like();
        assert!(matches("rges", &schema, &doc));
        assert!(matches("v1 charges", &schema, &doc));
        assert!(!matches("gv", &schema, &doc));
    }

    #[test]
    fn phrases_are_case_insensitive_substrings() {
        let doc = request("GET", "My Request", "", None);
        assert!(sidebar_matches("\"my req\"", &doc));
        assert!(sidebar_matches("\"MY REQ\"", &doc));
        assert!(!sidebar_matches("\"mr\"", &doc));
        assert!(!sidebar_matches("\"\"", &doc));
    }

    #[test]
    fn fields() {
        let post = request("post", "Create user", "https://api.yaak.app/users", Some("Users"));
        let get = request("get", "List users", "https://api.yaak.app/users", Some("Admin"));
        let rpc = grpc("Say hello", "helloworld.Greeter", "SayHello");

        assert!(sidebar_matches("@method:post", &post));
        assert!(sidebar_matches("@METHOD:Po", &post));
        assert!(!sidebar_matches("@method:post", &get));
        assert!(sidebar_matches("@url:yaak.app/users", &post));
        assert!(sidebar_matches("@folder:users", &post));
        assert!(!sidebar_matches("@folder:users", &get));
        assert!(sidebar_matches("@folder:users OR @folder:admin", &get));
        assert!(sidebar_matches("@type:grpc", &rpc));
        assert!(!sidebar_matches("-@type:grpc", &rpc));
        assert!(sidebar_matches("-@type:grpc", &post));
        assert!(sidebar_matches("@grpc_service:greeter @grpc_method:hello", &rpc));
        // A field the document lacks matches nothing, and its negation everything
        assert!(!sidebar_matches("@grpc_method:hello", &post));
        assert!(sidebar_matches("-@grpc_method:hello", &post));
        // `@` is required: without it, the term is free text
        assert!(!sidebar_matches("method:post", &post));
        assert!(sidebar_matches("localhost:50051", &Document::new("localhost:50051")));
        // An unknown field matches nothing
        assert!(!sidebar_matches("@nope:post", &post));
        // A trailing field with no value yet matches nothing, as before
        assert!(!sidebar_matches("@method:", &post));
    }

    #[test]
    fn groups_and_negation() {
        let a = Document::new("alpha");
        let b = Document::new("beta");
        let ac = Document::new("alpha charlie");
        assert!(sidebar_matches("(alpha OR beta) -charlie", &a));
        assert!(sidebar_matches("(alpha OR beta) -charlie", &b));
        assert!(!sidebar_matches("(alpha OR beta) -charlie", &ac));
        assert!(sidebar_matches("-(alpha OR beta)", &Document::new("delta")));
        assert!(sidebar_matches("alpha charlie", &ac));
        assert!(!sidebar_matches("alpha charlie", &a));
    }

    #[test]
    fn wildcards() {
        assert!(wildcard_match("*.github.com", "api.github.com"));
        assert!(!wildcard_match("*.github.com", "github.com"));
        assert!(wildcard_match("a*", "a"));
        assert!(wildcard_match("*", ""));
        assert!(wildcard_match("a*b*c", "aXXbYYc"));
        assert!(!wildcard_match("a*b*c", "aXXbYYcd"));
        assert!(wildcard_match("a**c", "ac"));
        assert!(!wildcard_match("ab*ba", "aba"));

        let doc = Document::default().with("url", "https://API.github.com/repos");
        let schema = proxy_like();
        assert!(matches("@url:https://api.github.com/*", &schema, &doc));
        assert!(matches("@url:*GITHUB*", &schema, &doc));
        assert!(!matches("@url:github*", &schema, &doc));
        // Quoted, `*` is literal
        assert!(!matches("@url:\"*github*\"", &schema, &doc));
        assert!(matches("@url:\"*\"", &schema, &Document::default().with("url", "a*b")));
    }

    #[test]
    fn presence() {
        let schema = proxy_like();
        let with = Document::default().with("header.x-cache", "HIT").with("status", 200.0);
        let without = Document::default().with("url", "x").with("status", 200.0);
        assert!(matches("@header.x-cache:*", &schema, &with));
        assert!(!matches("@header.x-cache:*", &schema, &without));
        assert!(matches("-@header.x-cache:*", &schema, &without));
        assert!(matches("@status:*", &schema, &with));
        assert!(!matches("@url:*", &schema, &Document::default().with("url", "")));
    }

    #[test]
    fn map_fields() {
        let schema = proxy_like();
        let doc = Document::default()
            .with("header.content-type", "application/json")
            .with("header.x-cache", "HIT");
        assert!(matches("@header.content-type:json", &schema, &doc));
        assert!(matches("@header.Content-Type:JSON", &schema, &doc));
        assert!(!matches("@header.content-type:xml", &schema, &doc));
        assert!(!matches("@header.accept:json", &schema, &doc));
        // The map with no key looks at every key
        assert!(matches("@header:hit", &schema, &doc));
        assert!(matches("@header:*", &schema, &doc));
    }

    #[test]
    fn numbers() {
        let schema = proxy_like();
        let doc = Document::default().with("status", 404.0).with("duration", 1500.0);
        assert!(matches("@status:404", &schema, &doc));
        assert!(!matches("@status:40", &schema, &doc));
        assert!(matches("@status:40*", &schema, &doc));
        assert!(matches("@status:>=400", &schema, &doc));
        assert!(!matches("@status:<400", &schema, &doc));
        assert!(matches("@status:[400 TO 499]", &schema, &doc));
        assert!(matches("@status:[404 TO 404]", &schema, &doc));
        assert!(!matches("@status:[200 TO 299]", &schema, &doc));
        assert!(matches("@duration:>1s", &schema, &doc));
        assert!(matches("@duration:>1000ms", &schema, &doc));
        assert!(matches("@duration:1.5s", &schema, &doc));
        assert!(matches("@duration:[1s TO 2s]", &schema, &doc));
        assert!(!matches("@duration:>2s", &schema, &doc));
        // A unit the field does not take matches nothing
        assert!(!matches("@duration:>1m", &schema, &doc));
        assert!(!matches("@status:>1ms", &schema, &doc));
    }

    #[test]
    fn comparisons_on_text_fields() {
        let doc = Document::default().with("url", "404");
        assert!(matches("@url:>400", &proxy_like(), &doc));
        assert!(!matches("@url:>400", &proxy_like(), &Document::default().with("url", "x")));
    }

    #[test]
    fn flags() {
        let schema = proxy_like();
        let failed = Document::default().with("error", true);
        let ok = Document::default().with("error", false);
        assert!(matches("@error:*", &schema, &failed));
        assert!(!matches("@error:*", &schema, &ok));
        assert!(matches("@error:true", &schema, &failed));
        assert!(matches("@error:false", &schema, &ok));
        assert!(matches("@error:false", &schema, &Document::default()));
        assert!(!matches("@error:maybe", &schema, &failed));
    }

    #[test]
    fn multiple_values() {
        let doc = Document::default().with("url", "a").with("url", "b");
        assert!(matches("@url:b", &proxy_like(), &doc));
    }

    #[test]
    fn document_from_json() {
        let doc: Document = serde_json::from_str(
            r#"{ "text": "x", "fields": { "url": "a", "tags": ["b", "c"], "status": 200, "error": true } }"#,
        )
        .unwrap();
        assert_eq!(doc.fields["url"], DocValues::One(DocValue::Text("a".into())));
        assert_eq!(doc.fields["status"], DocValues::One(DocValue::Number(200.0)));
        assert_eq!(doc.fields["error"], DocValues::One(DocValue::Flag(true)));
        assert!(matches("@status:200 @error:true", &proxy_like(), &doc));
    }

    // The cases from Yaak's former `format.test.ts`: a formatted field filter matches the value
    // it was made from. Values that contain query syntax are now quoted so they stay literal.

    fn matches_formatted_url(value: &str) -> bool {
        matches(
            &format_field("url", value, false),
            &sidebar(),
            &Document::default().with("url", value),
        )
    }

    #[test]
    fn format_keeps_url_like_values_bare() {
        assert_eq!(format_field("url", "yaak.app/foo-bar", false), "@url:yaak.app/foo-bar");
        assert!(matches_formatted_url("yaak.app/foo-bar"));
    }

    #[test]
    fn format_quotes_values_with_query_syntax() {
        // `*` is a wildcard and `)` closes a group, so this one is quoted now
        assert_eq!(format_field("url", "yaa$&#*@tsrna(*)", false), "@url:\"yaa$&#*@tsrna(*)\"");
        assert!(matches_formatted_url("yaa$&#*@tsrna(*)"));
        assert_eq!(format_field("url", "yaa$&#@tsrna(", false), "@url:yaa$&#@tsrna(");
        assert!(matches_formatted_url("yaa$&#@tsrna("));
    }

    #[test]
    fn format_keeps_values_that_start_with_an_operator_token_bare() {
        assert_eq!(format_field("url", "-foo", false), "@url:-foo");
        assert!(matches_formatted_url("-foo"));
    }

    #[test]
    fn format_keeps_boolean_operator_words_bare() {
        assert_eq!(format_field("url", "AND", false), "@url:AND");
        assert_eq!(format_field("url", "or", false), "@url:or");
        assert_eq!(format_field("url", "Not", false), "@url:Not");
        assert!(matches_formatted_url("AND"));
    }

    #[test]
    fn format_escapes_quoted_values() {
        assert_eq!(format_field("url", "say \"hi\"", false), "@url:\"say \\\"hi\\\"\"");
        assert!(matches_formatted_url("say \"hi\""));
    }

    #[test]
    fn format_quotes_values_that_start_with_a_quote() {
        assert_eq!(format_field("url", "\"hi\"", false), "@url:\"\\\"hi\\\"\"");
        assert!(matches_formatted_url("\"hi\""));
    }

    #[test]
    fn formatted_values_round_trip() {
        for value in [
            "a b",
            "*",
            ">5",
            "[1 TO 2]",
            "x)",
            "back\\slash",
            "\\\"",
            "tab\there",
            "é ü",
            "a*b",
            "<=3ms",
            "\\",
        ] {
            assert!(matches_formatted_url(value), "{value:?} did not round-trip");
        }
    }
}
