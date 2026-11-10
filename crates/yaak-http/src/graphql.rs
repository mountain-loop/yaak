//! GraphQL request detection, ported from the curl importer
//! (`plugins/importer-curl/src/graphql.ts`) so the proxy and the importer agree.

use serde_json::{Map, Value};
use url::Url;

/// A GraphQL request's JSON envelope.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphQlBody {
    pub query: String,
    /// The `variables` value as sent (object, string, or other), None when absent or null.
    pub variables: Option<Value>,
    pub operation_name: Option<String>,
}

impl GraphQlBody {
    /// `operationName` when present and non-blank, else the first named operation in `query`.
    pub fn operation(&self) -> Option<String> {
        match self.operation_name.as_deref().map(str::trim) {
            Some(name) if !name.is_empty() => Some(name.to_string()),
            _ => first_operation_name(&self.query),
        }
    }
}

/// A detected GraphQL request, as the proxy labels it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphQlOperation {
    /// The operation's name; for a batch, the first named operation in it. None when anonymous.
    pub name: Option<String>,
    /// How many operations the request carries: 1, or the batch's length.
    pub count: usize,
}

impl GraphQlOperation {
    /// The name, with ` +N` for the rest of a batch (`GetUser +2`); empty when anonymous.
    pub fn label(&self) -> String {
        match &self.name {
            None => String::new(),
            Some(name) if self.count > 1 => format!("{name} +{}", self.count - 1),
            Some(name) => name.clone(),
        }
    }
}

/// A JSON GraphQL envelope that passes the importer's scored check.
pub fn parse_json_body(content_type: Option<&str>, text: &str, url: &str) -> Option<GraphQlBody> {
    if !is_json(content_type) {
        return None;
    }
    match serde_json::from_str::<Value>(text).ok()? {
        Value::Object(body) => check_envelope(&body, &url_path(url)),
        _ => None,
    }
}

/// A non-empty JSON array whose every element passes `parse_json_body`'s check.
pub fn parse_json_batch(
    content_type: Option<&str>,
    text: &str,
    url: &str,
) -> Option<Vec<GraphQlBody>> {
    if !is_json(content_type) {
        return None;
    }
    let Value::Array(items) = serde_json::from_str::<Value>(text).ok()? else {
        return None;
    };
    if items.is_empty() {
        return None;
    }
    let path = url_path(url);
    items
        .iter()
        .map(|item| match item {
            Value::Object(body) => check_envelope(body, &path),
            _ => None,
        })
        .collect()
}

/// GraphQL over GET: the URL's `query`, `operationName` and `variables` parameters, scored like a
/// body.
pub fn parse_get(url: &str) -> Option<GraphQlBody> {
    let parsed = Url::parse(url).ok()?;
    let mut query = None;
    let mut operation_name = None;
    let mut variables = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "query" if query.is_none() => query = Some(value.into_owned()),
            "operationName" if operation_name.is_none() => {
                operation_name = Some(value.into_owned())
            }
            "variables" if variables.is_none() && !value.is_empty() => {
                variables = Some(Value::String(value.into_owned()))
            }
            _ => {}
        }
    }
    let body = GraphQlBody { query: query?, variables, operation_name };
    passes(&body, parsed.path()).then_some(body)
}

/// The proxy's check: GET reads the URL, anything else the body as one envelope or a batch.
pub fn detect(
    method: &str,
    url: &str,
    content_type: Option<&str>,
    body: Option<&[u8]>,
) -> Option<GraphQlOperation> {
    if method.eq_ignore_ascii_case("GET") {
        let body = parse_get(url)?;
        return Some(GraphQlOperation { name: body.operation(), count: 1 });
    }
    let text = std::str::from_utf8(body?).ok()?;
    if let Some(body) = parse_json_body(content_type, text, url) {
        return Some(GraphQlOperation { name: body.operation(), count: 1 });
    }
    let batch = parse_json_batch(content_type, text, url)?;
    Some(GraphQlOperation {
        name: batch.iter().find_map(GraphQlBody::operation),
        count: batch.len(),
    })
}

fn is_json(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|ct| ct.split(';').next())
        .is_some_and(|essence| essence.trim().eq_ignore_ascii_case("application/json"))
}

fn url_path(url: &str) -> String {
    match Url::parse(url) {
        Ok(parsed) => parsed.path().to_string(),
        Err(_) => url.to_string(),
    }
}

fn check_envelope(body: &Map<String, Value>, path: &str) -> Option<GraphQlBody> {
    let query = body.get("query")?.as_str()?;
    if body.keys().any(|k| !matches!(k.as_str(), "query" | "variables" | "operationName")) {
        return None;
    }
    let parsed = GraphQlBody {
        query: query.to_string(),
        variables: body.get("variables").filter(|v| !v.is_null()).cloned(),
        operation_name: body.get("operationName").and_then(Value::as_str).map(str::to_string),
    };
    passes(&parsed, path).then_some(parsed)
}

/// The importer's scored signals: a document signal and a score of at least 4.
fn passes(body: &GraphQlBody, path: &str) -> bool {
    let mut score = 0;
    let mut has_document = false;
    let query = body.query.as_str();
    // From the document's first token: comments and whitespace before it don't count.
    let trimmed = skip_leading_ignored(query).trim_end();

    if has_graphql_path_word(&path.to_lowercase()) {
        score += 2;
    }

    if ["query", "mutation", "subscription", "fragment"]
        .iter()
        .any(|keyword| starts_with_word(trimmed, keyword))
    {
        score += 3;
    } else if trimmed.len() >= 2 && trimmed.starts_with('{') && trimmed.ends_with('}') {
        score += 3;
        has_document = true;
    }

    if let Some(open) = query.find('{')
        && query[open..].contains('}')
    {
        score += 1;
        has_document = true;
    }

    if body.operation_name.as_deref().is_some_and(|name| !name.trim().is_empty()) {
        score += 1;
    }

    if matches!(body.variables, Some(Value::Object(_) | Value::Array(_) | Value::String(_))) {
        score += 1;
    }

    has_document && score >= 4
}

/// `document` from its first token: GraphQL's ignored tokens before it (whitespace, commas, a
/// byte order mark and `#` comments to the end of their line) left out.
fn skip_leading_ignored(document: &str) -> &str {
    let mut rest = document;
    loop {
        let trimmed =
            rest.trim_start_matches(|c: char| c.is_whitespace() || c == ',' || c == '\u{feff}');
        match trimmed.strip_prefix('#') {
            Some(comment) => rest = comment.find(['\n', '\r']).map_or("", |end| &comment[end..]),
            None => return trimmed,
        }
    }
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// `^keyword\b`
fn starts_with_word(text: &str, keyword: &str) -> bool {
    text.starts_with(keyword)
        && !text.as_bytes().get(keyword.len()).copied().is_some_and(is_word_byte)
}

/// `\b(graphql|gql)\b`
fn has_graphql_path_word(path: &str) -> bool {
    let bytes = path.as_bytes();
    ["graphql", "gql"].iter().any(|word| {
        path.match_indices(word).any(|(start, _)| {
            let end = start + word.len();
            let before = start > 0 && is_word_byte(bytes[start - 1]);
            let after = bytes.get(end).copied().is_some_and(is_word_byte);
            !before && !after
        })
    })
}

/// The first named `query`, `mutation` or `subscription` at the top level of a document, by a
/// token scan that skips comments and strings. Fragments are not operations.
pub fn first_operation_name(document: &str) -> Option<String> {
    let bytes = document.as_bytes();
    let mut i = 0;
    let mut braces = 0usize;
    let mut parens = 0usize;
    let mut definition_start = true;
    // Set after an operation keyword at a definition's start: the next token may be its name.
    let mut after_keyword = false;

    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'#' => {
                while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' {
                    i += 1;
                }
                continue;
            }
            b'"' if bytes[i..].starts_with(b"\"\"\"") => {
                after_keyword = false;
                i += 3;
                while i < bytes.len() && !bytes[i..].starts_with(b"\"\"\"") {
                    i += if bytes[i..].starts_with(b"\\\"\"\"") { 4 } else { 1 };
                }
                i += 3;
                continue;
            }
            b'"' => {
                after_keyword = false;
                i += 1;
                while i < bytes.len() && !matches!(bytes[i], b'"' | b'\n' | b'\r') {
                    i += if bytes[i] == b'\\' { 2 } else { 1 };
                }
                i += 1;
                continue;
            }
            b'_' | b'A'..=b'Z' | b'a'..=b'z' => {
                let start = i;
                while i < bytes.len() && is_word_byte(bytes[i]) {
                    i += 1;
                }
                let name = &document[start..i];
                if after_keyword {
                    return Some(name.to_string());
                }
                if definition_start && braces == 0 && parens == 0 {
                    after_keyword = matches!(name, "query" | "mutation" | "subscription");
                    definition_start = false;
                }
                continue;
            }
            b' ' | b'\t' | b'\n' | b'\r' | b',' => {}
            _ => {
                after_keyword = false;
                match b {
                    b'{' => {
                        braces += 1;
                        definition_start = false;
                    }
                    b'}' => {
                        braces = braces.saturating_sub(1);
                        if braces == 0 && parens == 0 {
                            definition_start = true;
                        }
                    }
                    b'(' => parens += 1,
                    b')' => parens = parens.saturating_sub(1),
                    _ => {}
                }
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const JSON: Option<&str> = Some("application/json");

    fn is_body(content_type: Option<&str>, body: Value, url: &str) -> bool {
        parse_json_body(content_type, &body.to_string(), url).is_some()
    }

    // Carried over from plugins/importer-curl/tests/graphql.test.ts.

    #[test]
    fn detects_named_query_documents_without_a_graphql_url() {
        let text = json!({
            "query": "query Search($id: ID!) { node(id: $id) { id } }",
            "variables": { "id": "123" },
            "operationName": "Search",
        })
        .to_string();
        assert_eq!(
            parse_json_body(JSON, &text, "https://api.example.com/search"),
            Some(GraphQlBody {
                query: "query Search($id: ID!) { node(id: $id) { id } }".into(),
                variables: Some(json!({ "id": "123" })),
                operation_name: Some("Search".into()),
            })
        );
    }

    #[test]
    fn detects_mutation_documents() {
        let body = json!({ "query": "mutation Save { saveThing { id } }" });
        assert!(is_body(JSON, body, "https://api.example.com"));
    }

    #[test]
    fn detects_anonymous_selection_set_documents() {
        let body = json!({ "query": "{ viewer { id email } }" });
        assert!(is_body(JSON, body, "https://api.example.com"));
    }

    #[test]
    fn detects_document_bodies_on_graphql_looking_paths() {
        let body = json!({ "query": "query Search { viewer { id } }", "operationName": "Search" });
        assert!(is_body(JSON, body, "https://api.example.com/v1/graphql"));
    }

    #[test]
    fn rejects_incomplete_operation_documents_on_graphql_paths() {
        let body = json!({ "query": "query Search", "operationName": "Search" });
        assert!(!is_body(JSON, body, "https://api.example.com/graphql"));
    }

    #[test]
    fn rejects_plain_json_query_fields_on_graphql_paths() {
        let body = json!({ "query": "SearchQueryInput!" });
        assert!(!is_body(JSON, body, "https://api.example.com/graphql"));
    }

    #[test]
    fn rejects_variables_and_operation_name_alone() {
        let body = json!({
            "query": "SearchQueryInput!",
            "variables": { "id": "123" },
            "operationName": "Search",
        });
        assert!(!is_body(JSON, body, "https://api.example.com"));
    }

    #[test]
    fn detects_bodies_with_string_variables_without_parsing_them() {
        let text = json!({
            "query": "query Search($id: ID!) { node(id: $id) { id } }",
            "variables": "{ \"id\": \"123\" }",
        })
        .to_string();
        assert_eq!(
            parse_json_body(JSON, &text, "https://api.example.com"),
            Some(GraphQlBody {
                query: "query Search($id: ID!) { node(id: $id) { id } }".into(),
                variables: Some(json!("{ \"id\": \"123\" }")),
                operation_name: None,
            })
        );
    }

    #[test]
    fn rejects_envelopes_with_extra_fields() {
        let body = json!({
            "query": "query Search($id: ID!) { node(id: $id) { id } }",
            "variables": { "id": "123" },
            "extensions": { "persistedQuery": { "version": 1, "sha256Hash": "abc123" } },
        });
        assert!(!is_body(JSON, body, "https://api.example.com/graphql"));
    }

    #[test]
    fn ignores_invalid_json_and_non_object_json() {
        assert_eq!(parse_json_body(JSON, "not json", "https://api.example.com/graphql"), None);
        assert_eq!(parse_json_body(JSON, "[]", "https://api.example.com/graphql"), None);
    }

    #[test]
    fn ignores_non_json_mime_types() {
        let body = json!({ "query": "query Search { viewer { id } }" });
        assert!(!is_body(Some("text/plain"), body, "https://api.example.com/graphql"));
    }

    // Additions for the proxy.

    #[test]
    fn content_type_essence_ignores_parameters_and_case() {
        let body = json!({ "query": "query Search { viewer { id } }" });
        let ct = Some(" Application/JSON ; charset=utf-8");
        assert!(is_body(ct, body.clone(), "https://api.example.com"));
        assert!(!is_body(None, body, "https://api.example.com"));
    }

    #[test]
    fn first_operation_name_reads_named_operations() {
        assert_eq!(first_operation_name("query GetUser { user { id } }"), Some("GetUser".into()));
        assert_eq!(
            first_operation_name("mutation SaveUser($u: In!) { save(u: $u) { id } }"),
            Some("SaveUser".into())
        );
        assert_eq!(
            first_operation_name("subscription OnMessage { message { body } }"),
            Some("OnMessage".into())
        );
    }

    #[test]
    fn first_operation_name_skips_anonymous_operations() {
        assert_eq!(first_operation_name("{ viewer { id } }"), None);
        assert_eq!(first_operation_name("query { viewer { id } }"), None);
        assert_eq!(first_operation_name("query($id: ID) { node(id: $id) { id } }"), None);
        assert_eq!(
            first_operation_name("{ viewer { id } } query Named { viewer { id } }"),
            Some("Named".into())
        );
    }

    #[test]
    fn first_operation_name_handles_variables_and_directives() {
        let doc = r#"query GetUser($id: ID! = "x", $f: In = {a: 1}) @cached(ttl: 60) {
            user(id: $id) @include(if: true) { name }
        }"#;
        assert_eq!(first_operation_name(doc), Some("GetUser".into()));
    }

    #[test]
    fn first_operation_name_ignores_keywords_in_strings_and_comments() {
        let doc = r#"
            # query Commented { x }
            { search(text: "query Quoted { x }") { id } }
            query Real { id }
        "#;
        assert_eq!(first_operation_name(doc), Some("Real".into()));
    }

    /// Comments and whitespace before a document's first token don't hide its keyword or its
    /// selection set, from detection or the name scan.
    #[test]
    fn detects_documents_after_leading_comments() {
        let commented = "# viewer query\nquery GetViewer { viewer { id } }";
        let body = json!({ "query": commented });
        assert!(is_body(JSON, body.clone(), "https://api.example.com/graphql"));
        let op = detect(
            "POST",
            "https://api.example.com/graphql",
            JSON,
            Some(body.to_string().as_bytes()),
        );
        assert_eq!(op.map(|o| o.label()).as_deref(), Some("GetViewer"));

        for document in [
            "\n\n  # one\r\n# two\n  mutation Save { save { id } }",
            "#only a comment line\nsubscription OnEvent { event { id } }",
            "\u{feff}  , # list\n{ viewer { id } }",
        ] {
            let body = json!({ "query": document });
            assert!(is_body(JSON, body, "https://api.example.com/graphql"), "{document:?}");
        }
        // A selection set alone after a comment needs no GraphQL path.
        let bare = json!({ "query": "# who\n{ viewer { id } }", "variables": {} });
        assert!(is_body(JSON, bare, "https://api.example.com/v1"));

        assert_eq!(
            first_operation_name("# c\n  # query Hidden { x }\n query Shown { a }"),
            Some("Shown".into())
        );
        // A comment and nothing else is no document.
        assert!(!is_body(
            JSON,
            json!({ "query": "# query X { a }" }),
            "https://api.example.com/graphql"
        ));
    }

    #[test]
    fn first_operation_name_skips_fragments() {
        let doc =
            "fragment UserFields on User { id name } query GetUser { user { ...UserFields } }";
        assert_eq!(first_operation_name(doc), Some("GetUser".into()));
        assert_eq!(first_operation_name("fragment query on User { id }"), None);
    }

    #[test]
    fn first_operation_name_skips_block_strings() {
        let doc = r#"{ a(text: """ query Hidden { "x" } \""" still """) } mutation Shown { b }"#;
        assert_eq!(first_operation_name(doc), Some("Shown".into()));
    }

    #[test]
    fn operation_prefers_operation_name() {
        let body = GraphQlBody {
            query: "query FromDoc { x }".into(),
            variables: None,
            operation_name: Some("FromParam".into()),
        };
        assert_eq!(body.operation(), Some("FromParam".into()));
        let body = GraphQlBody { operation_name: Some("  ".into()), ..body };
        assert_eq!(body.operation(), Some("FromDoc".into()));
    }

    #[test]
    fn parse_get_reads_operation_name_param() {
        let url = "https://api.example.com/graphql?query=%7B%20viewer%20%7B%20id%20%7D%20%7D\
                   &operationName=Viewer&variables=%7B%22a%22%3A1%7D";
        let body = parse_get(url).unwrap();
        assert_eq!(body.query, "{ viewer { id } }");
        assert_eq!(body.variables, Some(json!("{\"a\":1}")));
        assert_eq!(body.operation(), Some("Viewer".into()));
    }

    #[test]
    fn parse_get_reads_name_from_document() {
        let url = "https://api.example.com/api?query=query+GetUser+%7B+user+%7B+id+%7D+%7D";
        let op = detect("get", url, None, None).unwrap();
        assert_eq!(op, GraphQlOperation { name: Some("GetUser".into()), count: 1 });
    }

    #[test]
    fn parse_get_rejects_plain_search_queries() {
        assert_eq!(parse_get("https://shop.example.com/search?query=red+shoes"), None);
        assert_eq!(parse_get("https://shop.example.com/graphql?q=shoes"), None);
        assert_eq!(
            detect("GET", "https://shop.example.com/search?query=red+shoes", None, None),
            None
        );
    }

    #[test]
    fn detect_labels_batches() {
        let text = json!([
            { "query": "query A { a }" },
            { "query": "query B { b }" },
            { "query": "query C { c }" },
        ])
        .to_string();
        let url = "https://api.example.com/graphql";
        assert_eq!(parse_json_batch(JSON, &text, url).map(|b| b.len()), Some(3));
        let op = detect("POST", url, JSON, Some(text.as_bytes())).unwrap();
        assert_eq!(op, GraphQlOperation { name: Some("A".into()), count: 3 });
        assert_eq!(op.label(), "A +2");
    }

    #[test]
    fn detect_labels_batches_by_first_named_operation() {
        let text = json!([{ "query": "{ a }" }, { "query": "query B { b }" }]).to_string();
        let url = "https://api.example.com/graphql";
        let op = detect("POST", url, JSON, Some(text.as_bytes())).unwrap();
        assert_eq!(op.label(), "B +1");
    }

    #[test]
    fn batch_rejects_empty_or_mixed_arrays() {
        let url = "https://api.example.com/graphql";
        assert_eq!(parse_json_batch(JSON, "[]", url), None);
        let text = json!([{ "query": "query A { a }" }, { "foo": 1 }]).to_string();
        assert_eq!(parse_json_batch(JSON, &text, url), None);
    }

    #[test]
    fn detect_ignores_non_json_content_types_and_bad_bodies() {
        let url = "https://api.example.com/graphql";
        let text = json!({ "query": "query A { a }" }).to_string();
        assert_eq!(detect("POST", url, Some("text/plain"), Some(text.as_bytes())), None);
        assert_eq!(detect("POST", url, JSON, None), None);
        assert_eq!(detect("POST", url, JSON, Some(&[0xff, 0xfe])), None);
    }

    #[test]
    fn label_is_empty_for_anonymous_operations() {
        let url = "https://api.example.com/graphql";
        let text = json!({ "query": "{ viewer { id } }" }).to_string();
        let op = detect("POST", url, JSON, Some(text.as_bytes())).unwrap();
        assert_eq!(op, GraphQlOperation { name: None, count: 1 });
        assert_eq!(op.label(), "");
        assert_eq!(GraphQlOperation { name: None, count: 3 }.label(), "");
        assert_eq!(GraphQlOperation { name: Some("One".into()), count: 1 }.label(), "One");
    }
}
