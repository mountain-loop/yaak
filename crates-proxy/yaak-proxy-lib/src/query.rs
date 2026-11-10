//! Yaak Proxy's search: the query language of `yaak-query` over flows.
//!
//! A query is parsed by the crate, then prepared here: the shorthands the proxy keeps
//! (`@status:4xx`, `@host:*.github.com` for a site, `@path:/v1/*` for a folder and what is under
//! it, `@time:<5m`) become plain terms, and the hidden System flows are left out. The prepared
//! tree then runs two ways that must agree: compiled to a SQLite condition for listing and
//! counting ([`FlowQuery::sql`]), and in memory over one flow ([`FlowQuery::matches`]), for a
//! flow written while a search is shown. Both resolve each field term to the crate's
//! [`Condition`], and the values they test are made by the same functions here, which the
//! database calls as SQL functions ([`add_functions`]).

use crate::flows::{folder_name, is_system, sidebar_path};
use crate::models::{Flow, ModelPayload, ProxyHeader, SearchMatch, find_header};
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use rusqlite::functions::FunctionFlags;
use rusqlite::types::{Value, ValueRef};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{OnceLock, PoisonError, RwLock};
use ts_rs::TS;
use yaak_database::ModelChangeEvent;
use yaak_query::{
    CompareOp, Condition, DocValue, DocValues, Document, FieldDef, FieldKind, FieldValue, FreeText,
    Matcher, Node, NumberLiteral, Schema, Span, Unit, Utf16Offsets, contains_ignore_case,
    format_number, read_number, wildcard_match,
};

/// The flags `@is:` takes, in the order completion offers them.
pub const FLAGS: &[&str] = &[
    "error",
    "pending",
    "system",
    "encrypted",
    "rejected",
    "saved",
    "read",
    "loop",
    "ws",
    "sse",
    "grpc",
    "graphql",
];

/// Other names `@is:` takes for a flag, kept for queries written with them: `tunnelled` is
/// `encrypted`'s name from before.
const FLAG_ALIASES: &[(&str, &str)] = &[("tunnelled", "encrypted")];

/// Flags `@is:` will take once flows have what they need. Valid, matching nothing.
const FLAGS_NOT_YET: &[&str] = &["marked"];

/// Fields declared so completion shows them, matching nothing until they are built.
const FIELDS_NOT_YET: &[&str] = &["body", "req.body", "res.body"];

/// The values `@proto:` takes.
pub const PROTOS: &[&str] = &["h1", "h2", "ws", "sse", "grpc"];

/// The proxy's fields.
pub fn schema() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let units = |units: &[(&str, f64)]| FieldKind::Number {
            units: units
                .iter()
                .map(|(name, factor)| Unit { name: (*name).into(), factor: *factor })
                .collect(),
        };
        // As the app shows sizes: a kilobyte is 1000 bytes.
        let bytes = || units(&[("b", 1.0), ("kb", 1e3), ("mb", 1e6), ("gb", 1e9)]);
        // Each with what it is and a term using it, as completion shows them
        let field = |name: &str, kind: FieldKind, info: &str, example: &str| FieldDef {
            name: name.into(),
            kind,
            map: false,
            info: Some(info.into()),
            example: (!example.is_empty()).then(|| example.into()),
        };
        let map = |name: &str, info: &str, example: &str| FieldDef {
            map: true,
            ..field(name, FieldKind::Text, info, example)
        };
        let text = || FieldKind::Text;
        let number = || FieldKind::Number { units: vec![] };
        let ms = || units(&[("ms", 1.0), ("s", 1e3), ("m", 6e4)]);
        Schema::new(
            vec![
                field("host", text(), "Host, wildcards allowed", "@host:*.github.com"),
                field("path", text(), "URL path, /* for below", "@path:/v1/*"),
                field("method", text(), "GET, POST, …", "@method:post"),
                field("status", number(), "Response status", "@status:4xx  @status:>=400"),
                field("type", text(), "Content type", "@type:json"),
                field("app", text(), "App or program", "@app:Slack"),
                field(
                    "is",
                    text(),
                    "error, pending, system, encrypted, rejected, …",
                    "@is:error  -@is:system  @is:encrypted",
                ),
                map("header", "A header on either side", "@header.content-type:json"),
                map("req.header", "A request header", "@req.header.accept:*"),
                map("res.header", "A response header", "@res.header.x-cache:hit"),
                field("size", bytes(), "Response body size", "@size:>100kb"),
                field("req.size", bytes(), "Request body size", "@req.size:>1kb"),
                field("res.size", bytes(), "Response body size", "@res.size:<1mb"),
                field("duration", ms(), "Total time", "@duration:>500ms"),
                field("time", units(TIME_UNITS), "When the flow started", "@time:<5m"),
                field("url", text(), "The whole URL", "@url:*token=*"),
                map("query", "A query parameter", "@query.page:2"),
                field("scheme", text(), "http or https", "@scheme:https"),
                field("port", number(), "Port", "@port:8080"),
                field("proto", text(), "h1, h2, ws, sse, grpc", "@proto:h2"),
                field("id", number(), "Flow number", "@id:>1200"),
                field("cwd", text(), "Working folder", "@cwd:myapp"),
                field("pid", number(), "Process id", "@pid:4121"),
                field(
                    "graphql.operation",
                    text(),
                    "GraphQL operation name",
                    "@graphql.operation:GetUser",
                ),
                field("grpc.service", text(), "gRPC service", "@grpc.service:pkg.Greeter"),
                field("grpc.method", text(), "gRPC method", "@grpc.method:SayHello"),
                field("body", text(), "Not yet", ""),
                field("req.body", text(), "Not yet", ""),
                field("res.body", text(), "Not yet", ""),
            ],
            FreeText::Substring,
        )
    })
}

/// How long ago `@time` counts in, in milliseconds.
const TIME_UNITS: &[(&str, f64)] = &[
    ("ms", 1.0),
    ("s", 1e3),
    ("m", 6e4),
    ("h", 3.6e6),
    ("d", 8.64e7),
    ("w", 6.048e8),
];

// -- Preparing --

/// What a query leaves out unless it names it: System's flows, encrypted connections.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Hidden {
    pub system: bool,
    pub encrypted: bool,
}

/// System alone hidden, or nothing.
impl From<bool> for Hidden {
    fn from(system: bool) -> Self {
        Self { system, encrypted: false }
    }
}

/// A query prepared for running: its shorthands written out, hidden flows left out.
#[derive(Debug, Clone, PartialEq)]
pub struct FlowQuery {
    root: Option<Node>,
}

impl FlowQuery {
    /// `text` as of now. With `hidden.system`, macOS's own daemons are left out, unless the text
    /// says `@is:system` itself; with `hidden.encrypted`, connections tunnelled undecrypted,
    /// unless it says `@is:encrypted` (or `@is:tunnelled`).
    pub fn new(text: &str, hidden: impl Into<Hidden>) -> Self {
        Self::at(text, hidden, Utc::now())
    }

    /// [`Self::new`], with `now` for the times `@time` counts back from.
    pub fn at(text: &str, hidden: impl Into<Hidden>, now: DateTime<Utc>) -> Self {
        let hidden = hidden.into();
        let parsed = yaak_query::parse(text);
        let mentions = |flags: &[&str]| parsed.as_ref().is_some_and(|r| mentions_flag(r, flags));
        let hide: Vec<&str> = [
            (hidden.system && !mentions(&["system"])).then_some("system"),
            (hidden.encrypted && !mentions(&["encrypted", "tunnelled"])).then_some("encrypted"),
        ]
        .into_iter()
        .flatten()
        .collect();
        let mut root = parsed.map(|root| prepare(&root, now, &mut Vec::new()));
        for flag in hide {
            let span = Span::default();
            let not_flag = Node::Not { node: Box::new(is_flag(flag, span)), span };
            root = Some(match root {
                None => not_flag,
                Some(root) => Node::And { children: vec![root, not_flag], span },
            });
        }
        Self { root }
    }

    /// Covers every flow.
    pub fn is_empty(&self) -> bool {
        self.root.is_none()
    }

    /// Whether `flow` is one the query covers, as [`Self::sql`] decides it in the database.
    pub fn matches(&self, flow: &Flow) -> bool {
        self.matcher().matches(&document(flow))
    }

    /// The query resolved for matching many flows in memory.
    pub fn matcher(&self) -> Matcher {
        Matcher::new(self.root.as_ref(), schema())
    }

    /// The SQL condition on `flows` and its parameters, for a database with `columns`. In
    /// parentheses, so a caller may add to it with `AND`.
    pub fn sql(&self, columns: &FlowColumns) -> (String, Vec<Value>) {
        let mut sql = Sql { columns, params: Vec::new() };
        let condition = match &self.root {
            None => "1".to_string(),
            Some(root) => sql.node(root),
        };
        (format!("({condition})"), sql.params)
    }
}

/// `@is:<flag>`, as a prepared term.
fn is_flag(flag: &str, span: Span) -> Node {
    Node::Field {
        path: vec!["is".into()],
        value: FieldValue::Wildcard { pattern: flag.into() },
        span,
        path_span: span,
        value_span: span,
    }
}

/// The query names `@is:` one of `flags`, either way, so hiding it leaves it be.
fn mentions_flag(root: &Node, flags: &[&str]) -> bool {
    let mut found = false;
    root.walk(&mut |node| {
        if let Node::Field { path, value, .. } = node
            && path.len() == 1
            && path[0].eq_ignore_ascii_case("is")
            && let FieldValue::Text { text, .. } | FieldValue::Wildcard { pattern: text } = value
            && flags.iter().any(|f| text.eq_ignore_ascii_case(f))
        {
            found = true;
        }
    });
    found
}

/// What the schema alone does not catch, found while preparing.
#[derive(Debug, Clone, PartialEq)]
struct Issue {
    kind: QueryDiagnosticKind,
    path: String,
    span: Span,
}

/// A term that matches nothing, in place of one that cannot run.
fn never(span: Span) -> Node {
    Node::Phrase { text: String::new(), span }
}

fn number(value: f64) -> NumberLiteral {
    NumberLiteral { value, unit: None, raw: format_number(value) }
}

/// `node` with the proxy's shorthands written out as plain terms, keeping their spans.
fn prepare(node: &Node, now: DateTime<Utc>, issues: &mut Vec<Issue>) -> Node {
    match node {
        Node::And { children, span } => Node::And {
            children: children.iter().map(|c| prepare(c, now, issues)).collect(),
            span: *span,
        },
        Node::Or { children, span } => Node::Or {
            children: children.iter().map(|c| prepare(c, now, issues)).collect(),
            span: *span,
        },
        Node::Not { node: inner, span } => {
            Node::Not { node: Box::new(prepare(inner, now, issues)), span: *span }
        }
        Node::Term { .. } | Node::Phrase { .. } => node.clone(),
        Node::Field { path, value, span, path_span, value_span } => {
            let Some(field) = schema().resolve(path) else {
                return node.clone();
            };
            let with = |value: FieldValue| Node::Field {
                path: path.clone(),
                value,
                span: *span,
                path_span: *path_span,
                value_span: *value_span,
            };
            let mut issue = |kind| {
                let marked = if kind == QueryDiagnosticKind::NotYet { *span } else { *value_span };
                issues.push(Issue { kind, path: path.join("."), span: marked });
                never(*span)
            };
            match (field.def.name.as_str(), value) {
                // A class of statuses: `4xx`
                ("status", FieldValue::Text { text, quoted: false }) => match status_class(text) {
                    Some(class) => with(FieldValue::Range {
                        low: number(class * 100.0),
                        high: number(class * 100.0 + 99.0),
                    }),
                    None => node.clone(),
                },
                // A site: `*.github.com` is `github.com` and every host below it
                ("host", FieldValue::Wildcard { pattern }) if pattern.starts_with("*.") => {
                    Node::Or {
                        children: vec![
                            with(FieldValue::Wildcard { pattern: pattern[2..].to_string() }),
                            node.clone(),
                        ],
                        span: *span,
                    }
                }
                // A folder: `/v1/*` is `/v1` and everything under it
                ("path", FieldValue::Wildcard { pattern }) if pattern.ends_with("/*") => Node::Or {
                    children: vec![
                        with(FieldValue::Wildcard { pattern: pattern[..pattern.len() - 2].into() }),
                        node.clone(),
                    ],
                    span: *span,
                },
                // Named whole, as the sidebar names them: a part needs wildcards
                ("host" | "scheme" | "app" | "cwd", FieldValue::Text { text, .. })
                    if !text.is_empty() =>
                {
                    with(FieldValue::Wildcard { pattern: text.clone() })
                }
                ("is", FieldValue::Text { text, .. }) if !text.is_empty() => {
                    let mut flag = text.to_lowercase();
                    if let Some((_, to)) = FLAG_ALIASES.iter().find(|(alias, _)| *alias == flag) {
                        flag = to.to_string();
                    }
                    if FLAGS.contains(&flag.as_str()) {
                        with(FieldValue::Wildcard { pattern: flag })
                    } else if FLAGS_NOT_YET.contains(&flag.as_str()) {
                        issue(QueryDiagnosticKind::NotYet)
                    } else {
                        issue(QueryDiagnosticKind::InvalidValue)
                    }
                }
                // Not written yet
                ("time", FieldValue::Text { text, .. }) if text.is_empty() => node.clone(),
                ("time", value) => match time_node(value, now, &with) {
                    Some(node) => node,
                    None => issue(QueryDiagnosticKind::InvalidValue),
                },
                (name, _) if FIELDS_NOT_YET.contains(&name) => issue(QueryDiagnosticKind::NotYet),
                _ => node.clone(),
            }
        }
    }
}

/// The class `4xx` names, 4, or None when `text` is not one.
fn status_class(text: &str) -> Option<f64> {
    let class = text.strip_suffix("xx").or_else(|| text.strip_suffix("XX"))?;
    match class.as_bytes() {
        [d @ b'1'..=b'9'] => Some(f64::from(d - b'0')),
        _ => None,
    }
}

/// `@time`'s value as plain comparisons of when flows started, in Unix milliseconds. A
/// comparison or range of durations is how long ago (`<5m`: in the last five minutes); a date,
/// `2026-11-07`, a time today, `14:30`, or both, `2026-11-07T14:30`, all local, or an ISO time
/// with its offset, is the span it names, compared whole. None when the value is none of these.
fn time_node(
    value: &FieldValue,
    now: DateTime<Utc>,
    with: &impl Fn(FieldValue) -> Node,
) -> Option<Node> {
    let now_ms = now.timestamp_millis() as f64;
    let compare = |op, ms: f64| with(FieldValue::Compare { op, number: number(ms) });
    match value {
        FieldValue::Exists => Some(with(FieldValue::Exists)),
        FieldValue::Compare { op, number: age } => {
            // Less long ago is later
            let op = match op {
                CompareOp::Gt => CompareOp::Lt,
                CompareOp::Gte => CompareOp::Lte,
                CompareOp::Lt => CompareOp::Gt,
                CompareOp::Lte => CompareOp::Gte,
            };
            Some(compare(op, now_ms - age_ms(age)?))
        }
        FieldValue::Range { low, high } => {
            let (a, b) = (age_ms(low)?, age_ms(high)?);
            Some(with(FieldValue::Range {
                low: number(now_ms - a.max(b)),
                high: number(now_ms - a.min(b)),
            }))
        }
        FieldValue::Text { text, .. } => {
            let (op, point) = split_op(text);
            let (start, end) = time_span(point, now)?;
            Some(match op {
                None => {
                    let span = Span::default();
                    Node::And {
                        children: vec![compare(CompareOp::Gte, start), compare(CompareOp::Lt, end)],
                        span,
                    }
                }
                Some(CompareOp::Gt) => compare(CompareOp::Gte, end),
                Some(CompareOp::Gte) => compare(CompareOp::Gte, start),
                Some(CompareOp::Lt) => compare(CompareOp::Lt, start),
                Some(CompareOp::Lte) => compare(CompareOp::Lt, end),
            })
        }
        FieldValue::Wildcard { .. } => None,
    }
}

/// A duration in milliseconds, which must have a unit.
fn age_ms(number: &NumberLiteral) -> Option<f64> {
    let unit = number.unit.as_deref()?;
    let (_, factor) = TIME_UNITS.iter().find(|(name, _)| name.eq_ignore_ascii_case(unit))?;
    Some(number.value * factor)
}

fn split_op(text: &str) -> (Option<CompareOp>, &str) {
    for (prefix, op) in [
        (">=", CompareOp::Gte),
        ("<=", CompareOp::Lte),
        (">", CompareOp::Gt),
        ("<", CompareOp::Lt),
    ] {
        if let Some(rest) = text.strip_prefix(prefix) {
            return (Some(op), rest);
        }
    }
    (None, text)
}

/// The span of time `text` names, as Unix milliseconds from its start to just past its end.
fn time_span(text: &str, now: DateTime<Utc>) -> Option<(f64, f64)> {
    let local = |dt: NaiveDateTime| Local.from_local_datetime(&dt).earliest();
    let ms = |dt: DateTime<Local>| dt.timestamp_millis() as f64;
    if let Ok(dt) = DateTime::parse_from_rfc3339(text) {
        let start = dt.timestamp_millis() as f64;
        return Some((start, start + 1e3));
    }
    if let Ok(date) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        let start = local(date.and_time(NaiveTime::MIN))?;
        let end = local(date.succ_opt()?.and_time(NaiveTime::MIN))?;
        return Some((ms(start), ms(end)));
    }
    let today = now.with_timezone(&Local).date_naive();
    for (format, length) in [
        ("%Y-%m-%dT%H:%M:%S", 1e3),
        ("%Y-%m-%dT%H:%M", 6e4),
        ("%H:%M:%S", 1e3),
        ("%H:%M", 6e4),
    ] {
        let parsed = NaiveDateTime::parse_from_str(text, format)
            .ok()
            .or_else(|| NaiveTime::parse_from_str(text, format).ok().map(|t| today.and_time(t)));
        if let Some(dt) = parsed {
            let start = ms(local(dt)?);
            return Some((start, start + length));
        }
    }
    None
}

// -- Live flows --

/// The search the app shows, while it shows one. Each flow written meanwhile is matched
/// against it as its event is sent, so the event says whether it belongs in the search's list
/// and the app needs no matching of its own.
#[derive(Debug, Default)]
pub struct LiveSearch(RwLock<Option<Watched>>);

#[derive(Debug)]
struct Watched {
    key: String,
    text: String,
    hidden: Hidden,
}

impl LiveSearch {
    /// Matches flows against `text` from now on, their events naming `key`; None stops.
    pub fn watch(&self, watched: Option<(String, String, Hidden)>) {
        let watched = watched.map(|(key, text, hidden)| Watched { key, text, hidden });
        *self.0.write().unwrap_or_else(PoisonError::into_inner) = watched;
    }

    /// `flow` matched against the search shown, if any.
    pub fn check(&self, flow: &Flow) -> Option<SearchMatch> {
        let watched = self.0.read().unwrap_or_else(PoisonError::into_inner);
        let Watched { key, text, hidden } = watched.as_ref()?;
        // Prepared again for each flow, so `@time:<5m` counts back from now.
        let matches = FlowQuery::new(text, *hidden).matches(flow);
        Some(SearchMatch { key: key.clone(), matches })
    }

    /// The event for `flow`, written: created, or updated.
    pub fn payload(&self, flow: Flow, created: bool) -> ModelPayload {
        let search = self.check(&flow);
        ModelPayload { model: flow, change: ModelChangeEvent::Upsert { created }, search }
    }
}

// -- Seen values, for completion --

/// The newest flows completion looks through for values.
const SEEN_FLOWS: i64 = 2000;

/// Values offered per field at most.
const SEEN_VALUES: i64 = 200;

/// A header's values are offered only when it has had at most this many: more, and they are
/// near-unique (dates, ids), which is noise.
const HEADER_VALUES: i64 = 20;

/// The values seen for a field path, for completing it, most recent first: hosts, methods,
/// statuses, content types, protocols, schemes, apps, working folders, GraphQL operations, gRPC
/// services and methods, `@is` flags, header names, or a header's values when it has had few,
/// and query parameter names. Nothing for fields whose values are near-unique (URLs, paths, ids,
/// sizes, times, query parameter values).
pub fn seen_values(db: &crate::db::ProxyQueryManager, path: &str) -> Result<Vec<String>, String> {
    let path = path.to_lowercase();
    let column = match path.as_str() {
        "proto" => return Ok(PROTOS.iter().map(|p| p.to_string()).collect()),
        "is" => return Ok(FLAGS.iter().map(|f| f.to_string()).collect()),
        "host" => "url_host(url)",
        "method" => "method",
        "status" => "CAST(status AS TEXT)",
        "type" => "coalesce(content_type, header_value(request_headers, 'content-type'))",
        "scheme" => "url_scheme(url)",
        "app" => "client_name",
        "cwd" => "folder_name(client_cwd)",
        "graphql.operation" => "graphql_operation",
        "grpc.service" => "grpc_service",
        "grpc.method" => "grpc_method",
        "query" => return seen_query_names(db),
        "header" | "req.header" | "res.header" => {
            return seen_headers(db, &path, None);
        }
        _ => {
            for map in ["req.header.", "res.header.", "header."] {
                if let Some(name) = path.strip_prefix(map) {
                    return seen_headers(db, &map[..map.len() - 1], Some(name));
                }
            }
            return Ok(Vec::new());
        }
    };
    let sql = format!(
        "SELECT v FROM (SELECT {column} AS v, rid FROM ({})) WHERE v IS NOT NULL AND v != '' \
        GROUP BY v ORDER BY max(rid) DESC LIMIT {SEEN_VALUES}",
        newest_flows()
    );
    let mut values = select_strings(db, &sql, None)?;
    if path == "type" {
        // The media type alone, as a search names it
        let mut seen = HashSet::new();
        values = values
            .into_iter()
            .filter_map(|t| t.split(';').next().map(|m| m.trim().to_lowercase()))
            .filter(|m| !m.is_empty() && seen.insert(m.clone()))
            .collect();
    }
    Ok(values)
}

/// The newest flows not cleared, with their rowid as `rid`.
fn newest_flows() -> String {
    format!(
        "SELECT rowid AS rid, * FROM flows WHERE rowid > (SELECT coalesce(max(max_rowid), 0) \
        FROM flow_clear_mark) ORDER BY rowid DESC LIMIT {SEEN_FLOWS}"
    )
}

/// The names of the query parameters seen, for completing `@query.`.
fn seen_query_names(db: &crate::db::ProxyQueryManager) -> Result<Vec<String>, String> {
    let sql = format!(
        "SELECT q_lower(json_extract(kv.value, '$.name')) AS name FROM ({}) AS f, \
        json_each(url_query_json(f.url)) AS kv WHERE name IS NOT NULL AND name != '' \
        GROUP BY name ORDER BY max(f.rid) DESC LIMIT {SEEN_VALUES}",
        newest_flows()
    );
    select_strings(db, &sql, None)
}

/// Header names under a map, or one header's values when it has had few.
fn seen_headers(
    db: &crate::db::ProxyQueryManager,
    map: &str,
    name: Option<&str>,
) -> Result<Vec<String>, String> {
    let sides = match map {
        "req.header" => vec!["request_headers"],
        "res.header" => vec!["response_headers"],
        _ => vec!["request_headers", "response_headers"],
    };
    let pairs = sides
        .iter()
        .map(|side| {
            format!(
                "SELECT q_lower(json_extract(kv.value, '$.name')) AS name, \
                json_extract(kv.value, '$.value') AS value, f.rid AS rid \
                FROM ({}) AS f, json_each(f.{side}) AS kv",
                newest_flows()
            )
        })
        .collect::<Vec<_>>()
        .join(" UNION ALL ");
    match name {
        None => {
            let sql = format!(
                "SELECT name FROM ({pairs}) WHERE name IS NOT NULL AND name != '' \
                GROUP BY name ORDER BY max(rid) DESC LIMIT {SEEN_VALUES}"
            );
            select_strings(db, &sql, None)
        }
        Some(name) => {
            let sql = format!(
                "SELECT value FROM ({pairs}) WHERE name = ? AND value IS NOT NULL AND value != '' \
                GROUP BY value ORDER BY max(rid) DESC LIMIT {}",
                HEADER_VALUES + 1
            );
            let values = select_strings(db, &sql, Some(name.to_lowercase()))?;
            Ok(if values.len() as i64 > HEADER_VALUES { Vec::new() } else { values })
        }
    }
}

fn select_strings(
    db: &crate::db::ProxyQueryManager,
    sql: &str,
    param: Option<String>,
) -> Result<Vec<String>, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let params: Vec<Value> = param.into_iter().map(Value::from).collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params), |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

// -- Diagnostics --

/// What is wrong with a term, for the search box to mark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum QueryDiagnosticKind {
    /// No field has this path.
    UnknownField,
    /// The value cannot apply to the field: a unit it does not take, a flag it does not have.
    InvalidValue,
    /// Searchable later; matches nothing for now.
    NotYet,
}

/// A term the query cannot run, which then matches nothing. `start` and `end` count UTF-16
/// code units, as JavaScript does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct QueryDiagnostic {
    pub kind: QueryDiagnosticKind,
    pub path: String,
    pub start: u32,
    pub end: u32,
}

/// The terms of `text` that cannot run, in order.
pub fn diagnostics(text: &str) -> Vec<QueryDiagnostic> {
    let Some(root) = yaak_query::parse(text) else {
        return Vec::new();
    };
    let mut issues = Vec::new();
    let prepared = prepare(&root, Utc::now(), &mut issues);
    for diagnostic in schema().diagnostics(&prepared) {
        issues.push(match diagnostic {
            yaak_query::Diagnostic::UnknownField { path, span } => {
                Issue { kind: QueryDiagnosticKind::UnknownField, path, span }
            }
            yaak_query::Diagnostic::InvalidValue { path, span } => {
                Issue { kind: QueryDiagnosticKind::InvalidValue, path, span }
            }
        });
    }
    issues.sort_by_key(|i| (i.span.start, i.span.end));
    let offsets = Utf16Offsets::new(text);
    issues
        .into_iter()
        .map(|Issue { kind, path, span }| {
            let span = offsets.span(span);
            QueryDiagnostic { kind, path, start: span.start, end: span.end }
        })
        .collect()
}

// -- The values a flow is matched by --

/// The parts of a URL the fields read. A URL without a scheme, as an undecrypted connection's
/// may be, is all host.
struct UrlParts<'a> {
    scheme: Option<&'a str>,
    authority: &'a str,
    path: Option<&'a str>,
    query: Option<&'a str>,
}

fn url_parts(url: &str) -> UrlParts<'_> {
    let Some((scheme, rest)) = url.split_once("://") else {
        return UrlParts { scheme: None, authority: url, path: None, query: None };
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, rest) = rest.split_at(end);
    let rest = rest.split('#').next().unwrap_or_default();
    let (path, query) = match rest.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (rest, None),
    };
    UrlParts { scheme: Some(scheme), authority, path: Some(path), query }
}

/// The authority less any user info.
fn host_port(authority: &str) -> &str {
    authority.rsplit_once('@').map_or(authority, |(_, host)| host)
}

/// The host, lowercased and without its port.
pub fn url_hostname(url: &str) -> String {
    let host = host_port(url_parts(url).authority);
    let host = if host.starts_with('[') {
        host.find(']').map_or(host, |end| &host[..=end])
    } else {
        host.rsplit_once(':').map_or(host, |(h, _)| h)
    };
    host.to_lowercase()
}

/// The host as the sidebar names it: with its port when that is not the scheme's.
pub fn url_host(url: &str) -> String {
    sidebar_path(url).split('/').next().unwrap_or_default().to_string()
}

/// The port the URL names, or its scheme's.
pub fn url_port(url: &str) -> Option<i64> {
    let parts = url_parts(url);
    let host = host_port(parts.authority);
    let after_host = if host.starts_with('[') {
        host.find(']').map(|end| &host[end + 1..]).unwrap_or_default()
    } else {
        host
    };
    if let Some((_, port)) = after_host.rsplit_once(':')
        && let Ok(port) = port.parse()
    {
        return Some(port);
    }
    match parts.scheme?.to_ascii_lowercase().as_str() {
        "http" | "ws" => Some(80),
        "https" | "wss" => Some(443),
        _ => None,
    }
}

pub fn url_scheme(url: &str) -> Option<String> {
    url_parts(url).scheme.map(str::to_lowercase)
}

/// The path, without the query or fragment.
pub fn url_path(url: &str) -> Option<&str> {
    url_parts(url).path
}

/// The path as the sidebar names it, its empty segments left out (`/v1//users` is
/// `/v1/users`), when that differs from the path, so a sidebar row's term finds it.
pub fn url_sidebar_path(url: &str) -> Option<String> {
    let path = url_path(url)?;
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let normalized = format!("/{}", segments.join("/"));
    (normalized != path && !path.is_empty()).then_some(normalized)
}

/// The authority as written, user info and port included: the list's Host column.
pub fn url_authority(url: &str) -> &str {
    url_parts(url).authority
}

/// The query string as written, without its `?`: the list's Query column.
pub fn url_query_string(url: &str) -> Option<&str> {
    url_parts(url).query
}

/// The query's parameters, decoded, their names lowercased.
pub fn url_query(url: &str) -> Vec<(String, String)> {
    let Some(query) = url_parts(url).query else {
        return Vec::new();
    };
    url::form_urlencoded::parse(query.as_bytes())
        .filter(|(name, _)| !name.is_empty())
        .map(|(name, value)| (name.to_lowercase(), value.into_owned()))
        .collect()
}

/// What bare words search: the URL, the method, the status and the content type.
pub fn flow_text(
    url: &str,
    method: &str,
    status: Option<i64>,
    content_type: Option<&str>,
) -> String {
    let status = status.map(|s| s.to_string()).unwrap_or_default();
    format!("{url}\n{method}\n{status}\n{}", content_type.unwrap_or_default())
}

/// `h1` or `h2`, from the version the client spoke.
pub fn http_proto(version: &str) -> Option<&'static str> {
    match version {
        "HTTP/2" | "HTTP/2.0" => Some("h2"),
        "HTTP/3" | "HTTP/3.0" => Some("h3"),
        v if v.starts_with("HTTP/1") || v.starts_with("HTTP/0") => Some("h1"),
        _ => None,
    }
}

/// `ws`, `sse` or `grpc`, from a stream's kind as stored.
pub fn stream_proto(kind: &str) -> Option<&'static str> {
    match kind {
        "websocket" => Some("ws"),
        "sse" => Some("sse"),
        "grpc" | "grpc_web" => Some("grpc"),
        _ => None,
    }
}

/// The flags `@is:` finds on `flow`.
fn flags(flow: &Flow) -> Vec<&'static str> {
    let stream = flow.stream_kind.map(|k| k.as_str());
    let set = |flag: &str| match flag {
        "error" => flow.error.is_some() || flow.grpc_status.unwrap_or(0) != 0,
        "pending" => {
            flow.status.is_none()
                && flow.error.is_none()
                && !flow.cancelled
                && flow.elapsed_ms.is_none()
        }
        "system" => is_system(flow.client_bundle_id.as_deref(), flow.client_path.as_deref()),
        "encrypted" => flow.tunnelled,
        "rejected" => flow.tls_rejected.is_some(),
        "saved" => flow.saved_request_id.is_some(),
        "read" => flow.agent_read,
        "loop" => flow.status == Some(508),
        "ws" => stream == Some("websocket"),
        "sse" => stream == Some("sse"),
        "grpc" => matches!(stream, Some("grpc" | "grpc_web")),
        "graphql" => flow.graphql_operation.is_some(),
        _ => false,
    };
    FLAGS.iter().copied().filter(|f| set(f)).collect()
}

/// The response's content type, or the request's when it has none.
fn content_type(flow: &Flow) -> Option<&str> {
    flow.content_type.as_deref().or_else(|| find_header(&flow.request_headers, "content-type"))
}

/// `flow` as the evaluator sees it, with the values [`FlowQuery::sql`] reads in the database.
pub fn document(flow: &Flow) -> Document {
    let mut fields: HashMap<String, Vec<DocValue>> = HashMap::new();
    let mut add = |path: &str, value: DocValue| {
        fields.entry(path.to_lowercase()).or_default().push(value);
    };
    let text = |s: &str| DocValue::Text(s.to_string());
    let num = |n: f64| DocValue::Number(n);

    add("host", DocValue::Text(url_hostname(&flow.url)));
    add("host", DocValue::Text(url_host(&flow.url)));
    if let Some(port) = url_port(&flow.url) {
        add("port", num(port as f64));
    }
    if let Some(scheme) = url_scheme(&flow.url) {
        add("scheme", DocValue::Text(scheme));
    }
    if let Some(path) = url_path(&flow.url) {
        add("path", text(path));
    }
    if let Some(path) = url_sidebar_path(&flow.url) {
        add("path", DocValue::Text(path));
    }
    add("url", text(&flow.url));
    for (name, value) in url_query(&flow.url) {
        add(&format!("query.{name}"), DocValue::Text(value));
    }
    add("method", text(&flow.method));
    if let Some(t) = content_type(flow) {
        add("type", text(t));
    }
    if let Some(p) = http_proto(&flow.client_http_version) {
        add("proto", text(p));
    }
    if let Some(p) = flow.stream_kind.and_then(|k| stream_proto(k.as_str())) {
        add("proto", text(p));
    }
    add("id", num(flow.number as f64));
    if let Some(status) = flow.status {
        add("status", num(f64::from(status)));
    }
    add("size", num(flow.response_size as f64));
    add("res.size", num(flow.response_size as f64));
    add("req.size", num(flow.request_size as f64));
    if let Some(ms) = flow.elapsed_ms {
        add("duration", num(f64::from(ms)));
    }
    add("time", num(started_ms(&flow.started_at)));
    if let Some(app) = flow.client_bundle_id.as_deref().or(flow.client_path.as_deref()) {
        add("app", text(app));
    }
    if let Some(name) = &flow.client_name {
        add("app", text(name));
    }
    if flow.client_bundle_id.is_none()
        && let Some(folder) = folder_name(flow.client_cwd.as_deref())
    {
        add("app", text(folder));
    }
    if let Some(cwd) = &flow.client_cwd {
        add("cwd", text(cwd));
        if let Some(folder) = folder_name(Some(cwd)) {
            add("cwd", text(folder));
        }
    }
    if let Some(pid) = flow.client_pid {
        add("pid", num(f64::from(pid)));
    }
    // An anonymous operation is GraphQL with no name: `@is:graphql`, not `@graphql.operation:*`.
    if let Some(op) = flow.graphql_operation.as_deref().filter(|op| !op.is_empty()) {
        add("graphql.operation", text(op));
    }
    if let Some(service) = &flow.grpc_service {
        add("grpc.service", text(service));
    }
    if let Some(method) = &flow.grpc_method {
        add("grpc.method", text(method));
    }
    for (side, headers) in [
        ("req", &flow.request_headers),
        ("res", &flow.response_headers),
    ] {
        for ProxyHeader { name, value } in headers.iter().filter(|h| !h.name.is_empty()) {
            add(&format!("header.{name}"), text(value));
            add(&format!("{side}.header.{name}"), text(value));
        }
    }
    for flag in flags(flow) {
        add("is", text(flag));
    }

    Document {
        text: flow_text(
            &flow.url,
            &flow.method,
            flow.status.map(i64::from),
            flow.content_type.as_deref(),
        ),
        fields: fields.into_iter().map(|(path, values)| (path, DocValues::Many(values))).collect(),
    }
}

/// When a flow started, in Unix milliseconds, fractions kept, as `@time` compares it.
fn started_ms(started_at: &NaiveDateTime) -> f64 {
    let utc = started_at.and_utc();
    utc.timestamp() as f64 * 1e3 + f64::from(utc.timestamp_subsec_nanos()) / 1e6
}

/// Unix milliseconds as `started_at` is stored, so the database compares them as text in its
/// index's order: equal times are equal text, and later ones sort after.
fn stored_time(ms: f64) -> String {
    let nanos = (ms * 1e6).round() as i64;
    let dt = DateTime::<Utc>::from_timestamp_nanos(nanos).naive_utc();
    dt.format("%Y-%m-%d %H:%M:%S%.f").to_string()
}

// -- Compiling to SQL --

/// The columns of a database's flows table: one opened read-only before its migrations ran may
/// lack later ones, which then read as the model reads them, empty.
#[derive(Debug, Clone)]
pub struct FlowColumns(HashSet<String>);

impl FlowColumns {
    pub fn of(conn: &rusqlite::Connection) -> Self {
        let names = conn
            .prepare("SELECT name FROM pragma_table_info('flows')")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<_>>()
            })
            .unwrap_or_default();
        Self(names)
    }

    /// `name`, or what the model reads in its place when the table lacks it.
    pub(crate) fn col(&self, name: &str) -> String {
        if self.0.contains(name) {
            return name.to_string();
        }
        match name {
            "cancelled"
            | "tunnelled"
            | "agent_read"
            | "reconnect_requested"
            | "tunnel_excluded_built_in" => "0".into(),
            _ => "NULL".into(),
        }
    }
}

struct Sql<'a> {
    columns: &'a FlowColumns,
    params: Vec<Value>,
}

impl Sql<'_> {
    fn param(&mut self, value: impl Into<Value>) -> &'static str {
        self.params.push(value.into());
        "?"
    }

    fn node(&mut self, node: &Node) -> String {
        match node {
            Node::And { children, .. } => self.join(children, " AND ", "1"),
            Node::Or { children, .. } => self.join(children, " OR ", "0"),
            Node::Not { node, .. } => format!("NOT ({})", self.node(node)),
            Node::Term { text, .. } => self.free_text(text.trim().to_lowercase()),
            Node::Phrase { text, .. } => self.free_text(text.to_lowercase()),
            Node::Field { path, value, .. } => {
                let Some(field) = schema().resolve(path) else {
                    return "0".into();
                };
                let condition = Condition::new(&field.def.kind, value);
                if condition == Condition::Never {
                    return "0".into();
                }
                self.field(&field.def.name, field.key.as_deref(), &condition)
            }
        }
    }

    fn join(&mut self, children: &[Node], op: &str, empty: &str) -> String {
        if children.is_empty() {
            return empty.into();
        }
        let parts: Vec<String> = children.iter().map(|c| format!("({})", self.node(c))).collect();
        parts.join(op)
    }

    fn free_text(&mut self, needle: String) -> String {
        if needle.is_empty() {
            return "0".into();
        }
        let p = self.param(needle);
        format!("coalesce(q_contains(flow_text(url, method, status, content_type), {p}), 0)")
    }

    fn field(&mut self, name: &str, key: Option<&str>, condition: &Condition) -> String {
        let c = |n: &str| self.columns.col(n);
        let (values, numeric): (Vec<String>, bool) = match name {
            "host" => (vec!["url_hostname(url)".into(), "url_host(url)".into()], false),
            "port" => (vec!["url_port(url)".into()], true),
            "scheme" => (vec!["url_scheme(url)".into()], false),
            "path" => (vec!["url_path(url)".into(), "url_sidebar_path(url)".into()], false),
            "url" => (vec!["url".into()], false),
            "method" => (vec!["method".into()], false),
            "type" => (
                vec![
                    "coalesce(content_type, header_value(request_headers, 'content-type'))".into(),
                ],
                false,
            ),
            "proto" => (
                vec![
                    "http_proto(client_http_version)".into(),
                    format!("stream_proto({})", c("stream_kind")),
                ],
                false,
            ),
            "id" => (vec!["flows.rowid".into()], true),
            "status" => (vec!["status".into()], true),
            "size" | "res.size" => (vec!["response_size".into()], true),
            "req.size" => (vec!["request_size".into()], true),
            "duration" => (vec!["elapsed_ms".into()], true),
            "pid" => (vec![c("client_pid")], true),
            "graphql.operation" => (vec![format!("nullif({}, '')", c("graphql_operation"))], false),
            "grpc.service" => (vec![c("grpc_service")], false),
            "grpc.method" => (vec![c("grpc_method")], false),
            "app" => {
                let (bundle, path, name) =
                    (c("client_bundle_id"), c("client_path"), c("client_name"));
                let folder =
                    format!("CASE WHEN {bundle} IS NULL THEN folder_name({}) END", c("client_cwd"));
                (vec![format!("coalesce({bundle}, {path})"), name, folder], false)
            }
            "cwd" => {
                let cwd = c("client_cwd");
                (vec![cwd.clone(), format!("folder_name({cwd})")], false)
            }
            "time" => return self.time(condition),
            "is" => return self.flags(condition),
            "header" => {
                let both = [
                    self.pairs("request_headers", key, condition),
                    self.pairs("response_headers", key, condition),
                ];
                return format!("({} OR {})", both[0], both[1]);
            }
            "req.header" => return self.pairs("request_headers", key, condition),
            "res.header" => return self.pairs("response_headers", key, condition),
            "query" => return self.pairs("url_query_json(url)", key, condition),
            _ => return "0".into(),
        };
        self.any_value(&values, numeric, condition)
    }

    /// Any of the values passes.
    fn any_value(&mut self, values: &[String], numeric: bool, condition: &Condition) -> String {
        let parts: Vec<String> = values.iter().map(|v| self.test(v, numeric, condition)).collect();
        if parts.len() == 1 {
            parts.into_iter().next().unwrap_or_default()
        } else {
            format!("({})", parts.join(" OR "))
        }
    }

    /// `condition` on one value, never NULL. `numeric` for a value stored as a number, compared
    /// without reading it as one first.
    fn test(&mut self, value: &str, numeric: bool, condition: &Condition) -> String {
        let as_number = if numeric { value.to_string() } else { format!("q_number({value})") };
        let test = match condition {
            Condition::Contains(needle) => {
                format!("q_contains({value}, {})", self.param(needle.clone()))
            }
            Condition::Wildcard(pattern) => {
                format!("q_wildcard({value}, {})", self.param(pattern.clone()))
            }
            Condition::Present => format!("q_present({value})"),
            Condition::IsNumber => format!("{as_number} IS NOT NULL"),
            Condition::Equals(n) => format!("{as_number} = {}", self.param(*n)),
            Condition::Compare(op, n) => format!("{as_number} {} {}", op.as_str(), self.param(*n)),
            Condition::Range(low, high) => {
                format!("{as_number} BETWEEN {} AND {}", self.param(*low), self.param(*high))
            }
            // The proxy has no flag fields; `@is` is text.
            Condition::Flag(_) | Condition::Never => return "0".into(),
        };
        format!("coalesce({test}, 0)")
    }

    /// `@time`, prepared into comparisons of Unix milliseconds, compared with `started_at` as
    /// stored, through its index.
    fn time(&mut self, condition: &Condition) -> String {
        match condition {
            Condition::Present | Condition::IsNumber => "1".into(),
            Condition::Equals(ms) => format!("started_at = {}", self.param(stored_time(*ms))),
            Condition::Compare(op, ms) => {
                format!("started_at {} {}", op.as_str(), self.param(stored_time(*ms)))
            }
            Condition::Range(low, high) => format!(
                "started_at BETWEEN {} AND {}",
                self.param(stored_time(*low)),
                self.param(stored_time(*high))
            ),
            // Preparing leaves `@time` nothing else.
            _ => "0".into(),
        }
    }

    /// A flag's condition on the flow's columns.
    fn flag(&self, flag: &str) -> String {
        let c = |n: &str| self.columns.col(n);
        match flag {
            "error" => format!("(error IS NOT NULL OR coalesce({}, 0) != 0)", c("grpc_status")),
            "pending" => format!(
                "(status IS NULL AND error IS NULL AND NOT {} AND elapsed_ms IS NULL)",
                c("cancelled")
            ),
            "system" => format!("is_system({}, {})", c("client_bundle_id"), c("client_path")),
            "encrypted" => c("tunnelled"),
            "rejected" => format!("{} IS NOT NULL", c("tls_rejected")),
            "saved" => format!("{} IS NOT NULL", c("saved_request_id")),
            "read" => c("agent_read"),
            "loop" => "status = 508".into(),
            "ws" => format!("{} = 'websocket'", c("stream_kind")),
            "sse" => format!("{} = 'sse'", c("stream_kind")),
            "grpc" => format!("{} IN ('grpc', 'grpc_web')", c("stream_kind")),
            "graphql" => format!("{} IS NOT NULL", c("graphql_operation")),
            _ => "0".into(),
        }
    }

    /// `@is`: each flag set is a value, its name. A flag named whole is its column condition.
    fn flags(&mut self, condition: &Condition) -> String {
        if let Condition::Wildcard(pattern) = condition
            && !pattern.contains('*')
        {
            return match FLAGS.contains(&pattern.as_str()) {
                true => format!("coalesce({}, 0)", self.flag(pattern)),
                false => "0".into(),
            };
        }
        let values: Vec<String> = FLAGS
            .iter()
            .map(|f| format!("CASE WHEN coalesce({}, 0) THEN '{f}' END", self.flag(f)))
            .collect();
        self.any_value(&values, false, condition)
    }

    /// A map's values in a JSON array of `{ name, value }`: under `key` when given, any
    /// otherwise.
    fn pairs(&mut self, json: &str, key: Option<&str>, condition: &Condition) -> String {
        let name = match key {
            Some(key) => {
                format!(
                    "q_lower(json_extract(kv.value, '$.name')) = {} AND ",
                    self.param(key.to_lowercase())
                )
            }
            None => String::new(),
        };
        let test = self.test("json_extract(kv.value, '$.value')", false, condition);
        format!("EXISTS (SELECT 1 FROM json_each({json}) AS kv WHERE {name}{test})")
    }
}

// -- SQL functions --

/// A value as the evaluator reads text from it: text as it is, a number as `200`.
fn value_text(value: ValueRef<'_>) -> Option<std::borrow::Cow<'_, str>> {
    match value {
        ValueRef::Text(t) => Some(String::from_utf8_lossy(t)),
        ValueRef::Integer(i) => Some(format_number(i as f64).into()),
        ValueRef::Real(f) => Some(format_number(f).into()),
        ValueRef::Null | ValueRef::Blob(_) => None,
    }
}

/// Adds the functions [`FlowQuery::sql`] compiles to: the value tests of the crate's
/// conditions, and the values fields read from a flow's columns.
pub(crate) fn add_functions(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    let text_arg = |ctx: &rusqlite::functions::Context, i| ctx.get::<Option<String>>(i);

    conn.create_scalar_function("q_contains", 2, flags, |ctx| {
        let needle = ctx.get::<String>(1)?;
        Ok(match ctx.get_raw(0) {
            ValueRef::Text(t) => contains_ignore_case(&String::from_utf8_lossy(t), &needle),
            v => value_text(v).is_some_and(|t| t.contains(needle.as_str())),
        })
    })?;
    conn.create_scalar_function("q_wildcard", 2, flags, |ctx| {
        let pattern = ctx.get::<String>(1)?;
        Ok(match ctx.get_raw(0) {
            ValueRef::Text(t) => {
                wildcard_match(&pattern, &String::from_utf8_lossy(t).to_lowercase())
            }
            v => value_text(v).is_some_and(|t| wildcard_match(&pattern, &t)),
        })
    })?;
    conn.create_scalar_function("q_present", 1, flags, |ctx| {
        Ok(match ctx.get_raw(0) {
            ValueRef::Text(t) => !t.is_empty(),
            ValueRef::Integer(_) | ValueRef::Real(_) => true,
            ValueRef::Null | ValueRef::Blob(_) => false,
        })
    })?;
    conn.create_scalar_function("q_number", 1, flags, |ctx| {
        Ok(match ctx.get_raw(0) {
            ValueRef::Integer(i) => Some(i as f64),
            ValueRef::Real(f) => Some(f),
            ValueRef::Text(t) => read_number(&String::from_utf8_lossy(t)),
            ValueRef::Null | ValueRef::Blob(_) => None,
        })
    })?;
    conn.create_scalar_function("q_lower", 1, flags, move |ctx| {
        Ok(text_arg(ctx, 0)?.map(|t| t.to_lowercase()))
    })?;
    conn.create_scalar_function("flow_text", 4, flags, move |ctx| {
        let url = text_arg(ctx, 0)?.unwrap_or_default();
        let method = text_arg(ctx, 1)?.unwrap_or_default();
        let content_type = text_arg(ctx, 3)?;
        Ok(flow_text(&url, &method, ctx.get::<Option<i64>>(2)?, content_type.as_deref()))
    })?;
    conn.create_scalar_function("url_hostname", 1, flags, move |ctx| {
        Ok(url_hostname(&text_arg(ctx, 0)?.unwrap_or_default()))
    })?;
    conn.create_scalar_function("url_host", 1, flags, move |ctx| {
        Ok(url_host(&text_arg(ctx, 0)?.unwrap_or_default()))
    })?;
    conn.create_scalar_function("url_port", 1, flags, move |ctx| {
        Ok(url_port(&text_arg(ctx, 0)?.unwrap_or_default()))
    })?;
    conn.create_scalar_function("url_scheme", 1, flags, move |ctx| {
        Ok(url_scheme(&text_arg(ctx, 0)?.unwrap_or_default()))
    })?;
    conn.create_scalar_function("url_path", 1, flags, move |ctx| {
        Ok(url_path(&text_arg(ctx, 0)?.unwrap_or_default()).map(str::to_string))
    })?;
    conn.create_scalar_function("url_authority", 1, flags, move |ctx| {
        Ok(url_authority(&text_arg(ctx, 0)?.unwrap_or_default()).to_string())
    })?;
    conn.create_scalar_function("url_query_string", 1, flags, move |ctx| {
        Ok(url_query_string(&text_arg(ctx, 0)?.unwrap_or_default()).map(str::to_string))
    })?;
    conn.create_scalar_function("url_sidebar_path", 1, flags, move |ctx| {
        Ok(url_sidebar_path(&text_arg(ctx, 0)?.unwrap_or_default()))
    })?;
    conn.create_scalar_function("url_query_json", 1, flags, move |ctx| {
        let pairs: Vec<ProxyHeader> = url_query(&text_arg(ctx, 0)?.unwrap_or_default())
            .into_iter()
            .map(|(name, value)| ProxyHeader { name, value })
            .collect();
        serde_json::to_string(&pairs).map_err(|e| rusqlite::Error::UserFunctionError(e.into()))
    })?;
    conn.create_scalar_function("header_value", 2, flags, move |ctx| {
        let headers: Vec<ProxyHeader> =
            serde_json::from_str(&text_arg(ctx, 0)?.unwrap_or_default()).unwrap_or_default();
        let name = ctx.get::<String>(1)?;
        Ok(find_header(&headers, &name).map(str::to_string))
    })?;
    conn.create_scalar_function("http_proto", 1, flags, move |ctx| {
        Ok(text_arg(ctx, 0)?.and_then(|v| http_proto(&v)))
    })?;
    conn.create_scalar_function("stream_proto", 1, flags, move |ctx| {
        Ok(text_arg(ctx, 0)?.and_then(|v| stream_proto(&v)))
    })
}

#[cfg(test)]
mod tests;
