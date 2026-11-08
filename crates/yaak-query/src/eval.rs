//! Runs a parsed query in memory, against one document or a whole table of them.

use crate::ast::Node;
use crate::condition::Condition;
#[cfg(test)]
use crate::condition::wildcard_match;
use crate::fuzzy::{FuzzyScratch, fuzzy_match_in};
use crate::schema::{FreeText, Schema};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
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
    fn view(&self) -> Val<'_> {
        match self {
            DocValue::Text(text) => Val::Text(text),
            DocValue::Number(n) => Val::Number(*n),
            DocValue::Flag(b) => Val::Flag(*b),
        }
    }
}

/// Many documents with the same fields, as one flat run of cells: for each row, its free text,
/// then a text value (or none) per column. Cells may borrow from the input they were read from.
/// Matching a table is much cheaper than matching its rows one document at a time.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Table<'a> {
    /// Lowercase field paths, one per column.
    columns: Vec<String>,
    cells: Vec<Option<Cow<'a, str>>>,
}

impl<'a> Table<'a> {
    /// An empty table whose columns hold the fields at these paths.
    pub fn new(columns: impl IntoIterator<Item = impl Into<String>>) -> Self {
        let columns = columns.into_iter().map(|c| c.into().to_lowercase()).collect();
        Self { columns, cells: Vec::new() }
    }

    /// A table from its cells, already flat (text first, then a cell per column, row after
    /// row). `None` when the cells don't fill whole rows.
    pub fn from_cells(
        columns: impl IntoIterator<Item = impl Into<String>>,
        cells: Vec<Option<Cow<'a, str>>>,
    ) -> Option<Self> {
        let table = Self { cells, ..Self::new(columns) };
        table.cells.len().is_multiple_of(table.stride()).then_some(table)
    }

    /// A table from cells packed the way JavaScript can produce them cheaply: every cell joined
    /// into `joined`, with each cell's length in UTF-16 code units in `lengths` (or
    /// [`Table::NO_VALUE`] for a cell with no value). Cells borrow from `joined`. `None` when
    /// the lengths don't add up to `joined` or the cells don't fill whole rows.
    pub fn from_packed(
        columns: impl IntoIterator<Item = impl Into<String>>,
        joined: &'a str,
        lengths: &[u32],
    ) -> Option<Self> {
        let mut cells = Vec::with_capacity(lengths.len());
        let ascii = joined.is_ascii();
        let mut start = 0;
        for &len in lengths {
            if len == Self::NO_VALUE {
                cells.push(None);
                continue;
            }
            let end = if ascii {
                start + len as usize
            } else {
                // Walk `len` UTF-16 units forward
                let mut units = 0;
                let mut end = start;
                for c in joined.get(start..)?.chars() {
                    if units >= len as usize {
                        break;
                    }
                    units += c.len_utf16();
                    end += c.len_utf8();
                }
                if units != len as usize {
                    return None;
                }
                end
            };
            cells.push(Some(Cow::Borrowed(joined.get(start..end)?)));
            start = end;
        }
        if start != joined.len() {
            return None;
        }
        Self::from_cells(columns, cells)
    }

    /// The length [`Table::from_packed`] reads as a cell with no value.
    pub const NO_VALUE: u32 = u32::MAX;

    /// Adds a row: its free text, and a value or `None` per column, in column order. Missing
    /// trailing cells are `None`; extra ones are dropped.
    pub fn push(
        &mut self,
        text: impl Into<Cow<'a, str>>,
        cells: impl IntoIterator<Item = Option<Cow<'a, str>>>,
    ) {
        self.cells.push(Some(text.into()));
        let mut cells = cells.into_iter();
        for _ in 0..self.columns.len() {
            self.cells.push(cells.next().flatten());
        }
    }

    pub fn len(&self) -> usize {
        self.cells.len() / self.stride()
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    fn stride(&self) -> usize {
        self.columns.len() + 1
    }
}

/// A field value as matching sees it, borrowed from a document or a table.
#[derive(Clone, Copy, Debug)]
enum Val<'a> {
    Text(&'a str),
    Number(f64),
    Flag(bool),
}

impl Val<'_> {
    fn passes(&self, condition: &Condition) -> bool {
        match self {
            Val::Text(text) => condition.matches_text(text),
            Val::Number(n) => condition.matches_number(*n),
            Val::Flag(b) => condition.matches_flag(*b),
        }
    }
}

/// `text` lowercased into `out`, without a fresh allocation per call.
fn lowercase_into(text: &str, out: &mut String) {
    out.clear();
    if text.is_ascii() {
        out.push_str(text);
        out.make_ascii_lowercase();
    } else {
        out.push_str(&text.to_lowercase());
    }
}

/// Where field values come from: a [`Document`], or a row of a [`Table`].
trait FieldSource {
    /// Whether any value under `path` (lowercase) passes `test`. With `any_key`, `path` is a
    /// map field and the values of every key under it count.
    fn any_value(&self, path: &str, any_key: bool, test: &mut dyn FnMut(Val) -> bool) -> bool;
}

impl FieldSource for Document {
    fn any_value(&self, path: &str, any_key: bool, test: &mut dyn FnMut(Val) -> bool) -> bool {
        self.fields.iter().filter(|(key, _)| path_matches(key, path, any_key)).any(|(_, values)| {
            match values {
                DocValues::One(v) => test(v.view()),
                DocValues::Many(vs) => vs.iter().any(|v| test(v.view())),
            }
        })
    }
}

struct RowSource<'t, 'a> {
    columns: &'t [String],
    /// The row's cells, after its text.
    cells: &'t [Option<Cow<'a, str>>],
}

impl FieldSource for RowSource<'_, '_> {
    fn any_value(&self, path: &str, any_key: bool, test: &mut dyn FnMut(Val) -> bool) -> bool {
        self.columns.iter().zip(self.cells).any(|(column, cell)| {
            path_matches(column, path, any_key)
                && cell.as_deref().is_some_and(|v| test(Val::Text(v)))
        })
    }
}

/// Whether a document key is `path`, or with `any_key`, any key under it (`path.<key>`). Paths
/// are ASCII identifiers, so comparing ASCII case-insensitively is exact.
fn path_matches(key: &str, path: &str, any_key: bool) -> bool {
    let (key, path) = (key.as_bytes(), path.as_bytes());
    if key.eq_ignore_ascii_case(path) {
        return true;
    }
    any_key
        && key.len() > path.len() + 1
        && key[..path.len()].eq_ignore_ascii_case(path)
        && key[path.len()] == b'.'
}

/// Whether `doc` matches the query. `None` (an empty query) matches everything. To match many
/// documents, build a [`Matcher`] once instead.
pub fn evaluate(root: Option<&Node>, schema: &Schema, doc: &Document) -> bool {
    Matcher::new(root, schema).matches(doc)
}

/// A query resolved against a schema once (fields looked up, text lowercased), to match many
/// documents.
#[derive(Clone, Debug, PartialEq)]
pub struct Matcher {
    plan: Option<Plan>,
    fuzzy: bool,
    /// Whether any term reads the free text, which then has to be lowercased per document.
    uses_text: bool,
}

#[derive(Clone, Debug, PartialEq)]
enum Plan {
    And(Vec<Plan>),
    Or(Vec<Plan>),
    Not(Box<Plan>),
    /// A bare word, lowercased and trimmed.
    Term(String),
    /// A phrase, lowercased.
    Phrase(String),
    Field {
        /// The lowercase path the document stores the values under.
        path: String,
        /// A map field with no key: every key's values.
        any_key: bool,
        /// Never [`Condition::Never`], which plans as [`Plan::Never`].
        condition: Condition,
    },
    /// A term that can match nothing: an unknown field, an empty word or phrase.
    Never,
}

/// Buffers reused from one document to the next.
#[derive(Default)]
struct Scratch {
    text: String,
    fuzzy: FuzzyScratch,
}

impl Matcher {
    pub fn new(root: Option<&Node>, schema: &Schema) -> Self {
        let mut uses_text = false;
        let plan = root.map(|root| plan_node(root, schema, &mut uses_text));
        Self { plan, fuzzy: schema.free_text == FreeText::Fuzzy, uses_text }
    }

    /// Whether the query has no terms, so it matches everything.
    pub fn is_empty(&self) -> bool {
        self.plan.is_none()
    }

    pub fn matches(&self, doc: &Document) -> bool {
        self.matches_source(&doc.text, doc, &mut Scratch::default())
    }

    /// The indexes of the rows that match, in order.
    pub fn matching_rows(&self, table: &Table) -> Vec<u32> {
        let mut scratch = Scratch::default();
        let rows = table.cells.chunks_exact(table.stride());
        rows.enumerate()
            .filter(|(_, row)| {
                let text = row[0].as_deref().unwrap_or_default();
                let source = RowSource { columns: &table.columns, cells: &row[1..] };
                self.matches_source(text, &source, &mut scratch)
            })
            .map(|(i, _)| i as u32)
            .collect()
    }

    fn matches_source(&self, text: &str, source: &impl FieldSource, scratch: &mut Scratch) -> bool {
        let Some(plan) = &self.plan else { return true };
        if self.uses_text {
            lowercase_into(text, &mut scratch.text);
        }
        let Scratch { text, fuzzy } = scratch;
        self.eval(plan, text, source, fuzzy)
    }

    fn eval(
        &self,
        plan: &Plan,
        text: &str,
        source: &impl FieldSource,
        fuzzy: &mut FuzzyScratch,
    ) -> bool {
        match plan {
            Plan::And(children) => children.iter().all(|c| self.eval(c, text, source, fuzzy)),
            Plan::Or(children) => children.iter().any(|c| self.eval(c, text, source, fuzzy)),
            Plan::Not(node) => !self.eval(node, text, source, fuzzy),
            Plan::Term(term) if self.fuzzy => fuzzy_match_in(text, term, fuzzy),
            Plan::Term(term) | Plan::Phrase(term) => text.contains(term.as_str()),
            Plan::Field { path, any_key, condition } => {
                let any = source.any_value(path, *any_key, &mut |v| v.passes(condition));
                // `@flag:false`: no value is set
                if *condition == Condition::Flag(false) { !any } else { any }
            }
            Plan::Never => false,
        }
    }
}

fn plan_node(node: &Node, schema: &Schema, uses_text: &mut bool) -> Plan {
    let mut children =
        |nodes: &[Node]| nodes.iter().map(|n| plan_node(n, schema, uses_text)).collect();
    match node {
        Node::And { children: nodes, .. } => Plan::And(children(nodes)),
        Node::Or { children: nodes, .. } => Plan::Or(children(nodes)),
        Node::Not { node, .. } => Plan::Not(Box::new(plan_node(node, schema, uses_text))),
        Node::Term { text, .. } => {
            let term = text.trim().to_lowercase();
            if term.is_empty() {
                return Plan::Never;
            }
            *uses_text = true;
            Plan::Term(term)
        }
        Node::Phrase { text, .. } => {
            if text.is_empty() {
                return Plan::Never;
            }
            *uses_text = true;
            Plan::Phrase(text.to_lowercase())
        }
        Node::Field { path, value, .. } => {
            let Some(field) = schema.resolve(path) else {
                return Plan::Never;
            };
            let condition = Condition::new(&field.def.kind, value);
            if condition == Condition::Never {
                return Plan::Never;
            }
            Plan::Field {
                path: field.document_path(),
                any_key: field.def.map && field.key.is_none(),
                condition,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{FieldDef, FieldKind, Unit};
    use crate::{format_field, parse};

    fn text_field(name: &str) -> FieldDef {
        FieldDef { name: name.into(), kind: FieldKind::Text, map: false, info: None, example: None }
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
                FieldDef {
                    name: "header".into(),
                    kind: FieldKind::Text,
                    map: true,
                    info: None,
                    example: None,
                },
                FieldDef {
                    name: "status".into(),
                    kind: FieldKind::Number { units: vec![] },
                    map: false,
                    info: None,
                    example: None,
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
                    example: None,
                },
                FieldDef {
                    name: "error".into(),
                    kind: FieldKind::Flag,
                    map: false,
                    info: None,
                    example: None,
                },
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

    /// A table gives the same answers as matching its rows one document at a time.
    #[test]
    fn tables_match_like_documents() {
        let columns = [
            "method",
            "url",
            "name",
            "type",
            "folder",
            "grpc_service",
            "grpc_method",
        ];
        let docs = [
            request("post", "Create user", "https://api.yaak.app/users", Some("Users")),
            request("get", "List users", "https://api.yaak.app/users", Some("Admin")),
            request("GET", "My Request", "https://yaak.app", None),
            grpc("Say hello", "helloworld.Greeter", "SayHello"),
            Document::new("Folder"),
        ];
        let mut table = Table::new(columns);
        for doc in &docs {
            let cells = columns.iter().map(|c| match doc.fields.get(*c) {
                Some(DocValues::One(DocValue::Text(v))) => Some(Cow::Borrowed(v.as_str())),
                _ => None,
            });
            table.push(doc.text.as_str(), cells);
        }
        assert_eq!(table.len(), docs.len());

        for query in [
            "",
            "user",
            "mr",
            "\"my req\"",
            "@method:post",
            "-@type:grpc",
            "@folder:users OR @folder:admin",
            "(users OR hello) -create",
            "@grpc_method:*",
            "-@folder:*",
            "@url:*yaak.app*",
            "@nope:x",
            "-@nope:x",
            "method:post",
        ] {
            let matcher = Matcher::new(parse(query).as_ref(), &sidebar());
            let expected: Vec<u32> = (0..docs.len() as u32)
                .filter(|&i| sidebar_matches(query, &docs[i as usize]))
                .collect();
            assert_eq!(matcher.matching_rows(&table), expected, "{query:?}");
        }
        assert!(Matcher::new(None, &sidebar()).is_empty());
    }

    #[test]
    fn table_cells_line_up_with_columns() {
        let mut table = Table::new(["Method", "url"]);
        table.push("a", [Some("GET".into())]);
        table.push("b", [None, Some("x".into()), Some("ignored".into())]);
        assert_eq!(table.len(), 2);
        let rows = |q: &str| Matcher::new(parse(q).as_ref(), &sidebar()).matching_rows(&table);
        assert_eq!(rows("@method:get"), vec![0]);
        assert_eq!(rows("@url:x"), vec![1]);
        assert_eq!(rows("-@url:*"), vec![0]);
        assert_eq!(rows("b"), vec![1]);
    }

    #[test]
    fn tables_from_flat_cells() {
        let cells = vec![
            Some("GET List".into()),
            Some("GET".into()),
            None,
            Some("POST".into()),
        ];
        let table = Table::from_cells(["method"], cells.clone()).unwrap();
        assert_eq!(table.len(), 2);
        let rows = |q: &str| Matcher::new(parse(q).as_ref(), &sidebar()).matching_rows(&table);
        assert_eq!(rows("@method:post"), vec![1]);
        assert_eq!(rows("list"), vec![0]);
        // Cells that don't fill whole rows
        assert!(Table::from_cells(["method", "url"], cells).is_none());
        assert!(Table::from_cells(["method"], Vec::new()).unwrap().is_empty());
    }

    /// Packs cells the way the JavaScript side does: joined, with UTF-16 lengths.
    fn pack(cells: &[Option<&str>]) -> (String, Vec<u32>) {
        let joined = cells.iter().flatten().copied().collect();
        let lengths = cells
            .iter()
            .map(|c| c.map_or(Table::NO_VALUE, |c| c.encode_utf16().count() as u32))
            .collect();
        (joined, lengths)
    }

    #[test]
    fn tables_from_packed_cells() {
        let rows = |table: &Table, q: &str| {
            Matcher::new(parse(q).as_ref(), &sidebar()).matching_rows(table)
        };

        let (joined, lengths) = pack(&[
            Some("GET List"),
            Some("GET"),
            Some(""),
            None,
            Some("POST"),
            Some("x"),
        ]);
        let table = Table::from_packed(["method", "url"], &joined, &lengths).unwrap();
        assert_eq!(table.len(), 2);
        assert_eq!(rows(&table, "@method:post"), vec![1]);
        assert_eq!(rows(&table, "@url:x"), vec![1]);
        assert_eq!(rows(&table, "list"), vec![0]);
        assert_eq!(rows(&table, "-@method:*"), Vec::<u32>::new());

        // Non-ASCII text, including a character outside the BMP (two UTF-16 units)
        let (joined, lengths) = pack(&[
            Some("Über 🦀 crab"),
            Some("GET"),
            Some("Café"),
            Some("x"),
            None,
            Some("y"),
        ]);
        let table = Table::from_packed(["method", "name"], &joined, &lengths).unwrap();
        assert_eq!(rows(&table, "🦀"), vec![0]);
        assert_eq!(rows(&table, "@name:café"), vec![0]);
        assert_eq!(rows(&table, "@name:y"), vec![1]);

        // Lengths that don't add up, or don't fill whole rows
        assert!(Table::from_packed(["method"], "abc", &[1, 1]).is_none());
        assert!(Table::from_packed(["method"], "abc", &[2, 2]).is_none());
        assert!(Table::from_packed(["method"], "abc", &[3]).is_none());
        assert!(Table::from_packed(["method"], "é", &[2, 0]).is_none());
        assert!(Table::from_packed(["method"], "", &[]).unwrap().is_empty());
    }

    #[test]
    fn non_ascii_text_matches_case_insensitively() {
        let doc = Document::new("ÜBER Café").with("name", "ÜBER Café");
        assert!(sidebar_matches("über", &doc));
        assert!(sidebar_matches("@name:café", &doc));
        assert!(sidebar_matches("\"über c\"", &doc));
        assert!(!sidebar_matches("@name:cafe", &doc));
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
