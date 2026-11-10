use crate::bodies;
use crate::db::{ProxyQueryManager, Stores};
use crate::models::{Flow, FlowBody};
use crate::query::{FlowColumns, FlowQuery, Hidden};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_database::UpsertModelInfo;
use yaak_models::blob_manager::BlobManager;

/// Which flows a listing or a HAR export covers: a search, and a page of it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FlowFilter {
    /// A search in the query language (`crate::query`): `stripe @status:4xx`,
    /// `@host:*.github.com -@is:system`. None or blank covers every flow.
    #[ts(optional)]
    pub query: Option<String>,
    /// Leaves out macOS's own daemons, as hiding System does, unless the query says
    /// `@is:system` itself.
    #[ts(optional, as = "Option<bool>")]
    pub hide_system: bool,
    /// Leaves out HTTPS connections passed through undecrypted, as hiding Encrypted does,
    /// unless the query says `@is:encrypted` itself.
    #[ts(optional, as = "Option<bool>")]
    pub hide_encrypted: bool,
    /// At most this many flows, the newest.
    #[ts(optional, type = "number")]
    pub limit: Option<usize>,
    /// Only flows recorded after the flow with this id, for following new traffic. Flows are
    /// recorded when they end, so a slow one that started earlier still comes through.
    #[ts(optional)]
    pub after: Option<String>,
    /// Only flows older than the flow with this id, by start and then id, for paging back
    /// through older traffic.
    #[ts(optional)]
    pub before: Option<String>,
    /// The order to list in, the list's column sort: each key in turn, then by start and id,
    /// oldest first. Empty lists newest first, as without it. With keys, `before` does not
    /// apply; `cursor` pages instead.
    #[ts(optional, as = "Option<Vec<FlowSortKey>>")]
    pub sort: Vec<FlowSortKey>,
    /// Only flows after these values in `sort`'s order, for paging through a sort: the `cursor`
    /// of the page before, the sort values of its last flow as it was read, so a change to that
    /// flow since does not move where the next page starts.
    #[ts(optional, as = "Option<Vec<SortValue>>")]
    pub cursor: Option<Vec<SortValue>>,
}

/// One of a flow's sort values, as the database sorted it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum SortValue {
    Int(#[ts(type = "number")] i64),
    Text(String),
}

impl SortValue {
    fn from_sql(value: Value) -> Self {
        match value {
            Value::Integer(i) => Self::Int(i),
            Value::Real(f) => Self::Int(f as i64),
            Value::Text(t) => Self::Text(t),
            Value::Null | Value::Blob(_) => Self::Text(String::new()),
        }
    }

    fn to_sql(&self) -> Value {
        match self {
            Self::Int(i) => Value::Integer(*i),
            Self::Text(t) => Value::Text(t.clone()),
        }
    }
}

/// A column the list sorts by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum SortColumn {
    Number,
    App,
    Method,
    Host,
    Path,
    Query,
    Status,
    Type,
    Size,
    RequestSize,
    Time,
    Latency,
    Started,
    Remote,
    Version,
    Tls,
    Operation,
}

/// One key of a sort.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FlowSortKey {
    #[ts(type = "SortColumn | `field:${string}`")]
    pub column: SortBy,
    pub descending: bool,
}

/// What a sort key sorts by: a column the list has built in, or a column the person added for
/// a header or query parameter, written `field:header.x-cache` as the app names the column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SortBy {
    Column(SortColumn),
    Field(FieldPath),
}

impl From<SortColumn> for SortBy {
    fn from(column: SortColumn) -> Self {
        Self::Column(column)
    }
}

const FIELD_PREFIX: &str = "field:";

impl Serialize for SortBy {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Column(column) => column.serialize(serializer),
            Self::Field(field) => serializer.serialize_str(&format!("{FIELD_PREFIX}{field}")),
        }
    }
}

impl<'de> Deserialize<'de> for SortBy {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::{Error, IntoDeserializer};
        let text = String::deserialize(deserializer)?;
        if let Some(path) = text.strip_prefix(FIELD_PREFIX) {
            return FieldPath::parse(path)
                .map(Self::Field)
                .ok_or_else(|| D::Error::custom(format!("Invalid sort field {path:?}")));
        }
        let column: serde::de::value::StrDeserializer<'_, D::Error> =
            text.as_str().into_deserializer();
        SortColumn::deserialize(column).map(Self::Column)
    }
}

/// The map a custom column's field is under, as the query language names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldMap {
    /// `header.`: the response's header, or the request's when the response has none.
    Header,
    RequestHeader,
    ResponseHeader,
    Query,
}

impl FieldMap {
    // `req.header.` and `res.header.` before `header.`, which neither starts with, all the same
    const ALL: [Self; 4] = [
        Self::RequestHeader,
        Self::ResponseHeader,
        Self::Header,
        Self::Query,
    ];

    fn prefix(self) -> &'static str {
        match self {
            Self::Header => "header.",
            Self::RequestHeader => "req.header.",
            Self::ResponseHeader => "res.header.",
            Self::Query => "query.",
        }
    }
}

/// A custom column's field: a header or query parameter by name, `header.x-cache`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldPath {
    map: FieldMap,
    /// Lowercased: names compare without regard to case
    name: String,
}

impl FieldPath {
    /// The field `path` names, by the rule the app's `customPath` in `lib/columns.ts` keeps for
    /// a custom column: a map, then a name of the characters the query language takes in a
    /// field path, so the column's value makes a term a search can run.
    pub fn parse(path: &str) -> Option<Self> {
        let lower = path.to_ascii_lowercase();
        let map = FieldMap::ALL.into_iter().find(|m| lower.starts_with(m.prefix()))?;
        let name = &lower[map.prefix().len()..];
        if name.contains('.') || !yaak_query::is_valid_path(name) {
            return None;
        }
        Some(Self { map, name: name.to_string() })
    }

    /// The value the column shows, as text in SQL, NULL when the flow has none: the first value
    /// under the name, as `customValue` in the app's `lib/columns.ts` reads it. Each `?` is
    /// bound to the name, one parameter for each.
    fn sql(&self) -> (String, Vec<Value>) {
        let first = |json: &str| {
            format!(
                "(SELECT json_extract(kv.value, '$.value') FROM json_each({json}) AS kv \
                WHERE q_lower(json_extract(kv.value, '$.name')) = ? ORDER BY kv.key LIMIT 1)"
            )
        };
        let (sql, sides) = match self.map {
            FieldMap::Header => (
                format!("coalesce({}, {})", first("response_headers"), first("request_headers")),
                2,
            ),
            FieldMap::RequestHeader => (first("request_headers"), 1),
            FieldMap::ResponseHeader => (first("response_headers"), 1),
            FieldMap::Query => (first("url_query_json(url)"), 1),
        };
        (sql, vec![Value::Text(self.name.clone()); sides])
    }
}

impl std::fmt::Display for FieldPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}{}", self.map.prefix(), self.name)
    }
}

/// What an empty number sorts as: below every value, as an empty text's `''` is.
const EMPTY_NUMBER: &str = "-1000000000000000000";

impl SortColumn {
    /// The value the column sorts by, in SQL, never NULL: empty values (none, `''` or `0`)
    /// lowest, text without regard to ASCII case. `columnSortKey` in the app's
    /// `lib/columns.ts` makes the same values for flows it places itself.
    fn sql(self, columns: &FlowColumns) -> String {
        let c = |n: &str| columns.col(n);
        let number = |v: &str| format!("coalesce(nullif({v}, 0), {EMPTY_NUMBER})");
        let text = |v: &str| format!("(coalesce({v}, '') COLLATE NOCASE)");
        match self {
            Self::Number => "flows.rowid".into(),
            Self::App => text(&format!(
                "coalesce({}, {}, {})",
                c("client_name"),
                c("client_bundle_id"),
                c("client_path")
            )),
            Self::Method => text("method"),
            Self::Host => text("url_authority(url)"),
            Self::Path => text("url_path(url)"),
            Self::Query => text("url_query_string(url)"),
            Self::Status => {
                format!("CASE WHEN error IS NOT NULL THEN -1 ELSE {} END", number("status"))
            }
            Self::Type => text("content_type"),
            Self::Size => format!(
                "CASE WHEN error IS NOT NULL AND status IS NULL THEN {EMPTY_NUMBER} ELSE {} END",
                number("response_size")
            ),
            Self::RequestSize => number("request_size"),
            Self::Time => number("elapsed_ms"),
            Self::Latency => number("elapsed_headers_ms"),
            Self::Started => "started_at".into(),
            Self::Remote => text("remote_addr"),
            Self::Version => text("coalesce(upstream_http_version, client_http_version)"),
            Self::Tls => text(&c("upstream_tls_version")),
            Self::Operation => {
                let (service, method) = (c("grpc_service"), c("grpc_method"));
                text(&format!(
                    "CASE WHEN {service} IS NOT NULL AND {method} IS NOT NULL \
                    THEN {service} || '/' || {method} ELSE {} END",
                    c("graphql_operation")
                ))
            }
        }
    }
}

impl SortBy {
    /// The value the key sorts by, in SQL, as [`SortColumn::sql`] makes it, and the parameters
    /// its `?`s are bound to, in order.
    fn sql(&self, columns: &FlowColumns) -> (String, Vec<Value>) {
        match self {
            Self::Column(column) => (column.sql(columns), Vec::new()),
            // Text, as the other text columns sort
            Self::Field(field) => {
                let (value, params) = field.sql();
                (format!("(coalesce({value}, '') COLLATE NOCASE)"), params)
            }
        }
    }
}

/// One term of a sort in SQL: its value, the parameters the value's `?`s are bound to, and
/// whether it descends.
struct SortTerm {
    sql: String,
    params: Vec<Value>,
    descending: bool,
}

/// A sort's keys in SQL, then start and id, ascending.
fn sort_terms(sort: &[FlowSortKey], columns: &FlowColumns) -> Vec<SortTerm> {
    let tiebreak = |sql: &str| SortTerm { sql: sql.into(), params: Vec::new(), descending: false };
    sort.iter()
        .map(|k| {
            let (sql, params) = k.column.sql(columns);
            SortTerm { sql, params, descending: k.descending }
        })
        .chain([tiebreak("started_at"), tiebreak("flows.id")])
        .collect()
}

/// The condition for the flows after `cursor`'s values in a sort, and its parameters: each key
/// equal up to one that is past the cursor's.
fn sort_after(terms: &[SortTerm], cursor: &[Value]) -> (String, Vec<Value>) {
    let mut params = Vec::new();
    let mut alternatives = Vec::new();
    for (i, term) in terms.iter().enumerate() {
        let mut parts = Vec::new();
        for (before, value) in terms[..i].iter().zip(cursor) {
            parts.push(format!("{} = ?", before.sql));
            params.extend(before.params.iter().cloned());
            params.push(value.clone());
        }
        parts.push(format!("{} {} ?", term.sql, if term.descending { "<" } else { ">" }));
        params.extend(term.params.iter().cloned());
        params.push(cursor[i].clone());
        alternatives.push(format!("({})", parts.join(" AND ")));
    }
    (format!("({})", alternatives.join(" OR ")), params)
}

impl FlowFilter {
    /// A filter for a search alone.
    pub fn search(query: impl Into<String>) -> Self {
        Self { query: Some(query.into()), ..Self::default() }
    }

    /// The filter from a query string's `query`, `hide_system`, `hide_encrypted`, `limit`,
    /// `after` and `before`.
    pub fn from_query(query: &str) -> Result<Self, String> {
        let mut filter = Self::default();
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            let value = Some(value.into_owned()).filter(|v| !v.is_empty());
            match key.as_ref() {
                "query" => filter.query = value,
                "hide_system" => {
                    filter.hide_system = value
                        .map(|v| v.parse().map_err(|_| format!("Invalid hide_system {v:?}")))
                        .transpose()?
                        .unwrap_or_default()
                }
                "hide_encrypted" => {
                    filter.hide_encrypted = value
                        .map(|v| v.parse().map_err(|_| format!("Invalid hide_encrypted {v:?}")))
                        .transpose()?
                        .unwrap_or_default()
                }
                "after" => filter.after = value,
                "before" => filter.before = value,
                "limit" => {
                    filter.limit = value
                        .map(|v| v.parse().map_err(|_| format!("Invalid limit {v:?}")))
                        .transpose()?
                }
                _ => {}
            }
        }
        Ok(filter)
    }

    pub fn to_query(&self) -> String {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        let limit = self.limit.map(|l| l.to_string());
        let hide_system = self.hide_system.then(|| "true".to_string());
        let hide_encrypted = self.hide_encrypted.then(|| "true".to_string());
        for (key, value) in [
            ("query", &self.query),
            ("hide_system", &hide_system),
            ("hide_encrypted", &hide_encrypted),
            ("limit", &limit),
            ("after", &self.after),
            ("before", &self.before),
        ] {
            if let Some(value) = value {
                query.append_pair(key, value);
            }
        }
        query.finish()
    }

    /// The search, prepared to run now.
    pub fn flow_query(&self) -> FlowQuery {
        FlowQuery::new(self.query.as_deref().unwrap_or_default(), self.hidden())
    }

    /// What the filter leaves out unless its query names it.
    pub fn hidden(&self) -> Hidden {
        Hidden { system: self.hide_system, encrypted: self.hide_encrypted }
    }

    /// Narrows more than `after`, `before` and `limit` do, so it covers fewer than all flows.
    pub fn narrows(&self) -> bool {
        !self.flow_query().is_empty()
    }

    /// The SQL condition for the search, and its parameters, for the database `conn` reads,
    /// which may be from before later columns, when read without migrating.
    fn condition_in(&self, conn: &rusqlite::Connection) -> (String, Vec<Value>) {
        self.flow_query().sql(&FlowColumns::of(conn))
    }
}

/// The host and port of `url`, in SQL: what follows `://` up to the first `/`, `?` or `#`.
const HOST_SQL: &str = "(SELECT CASE WHEN instr(r, '/') > 0 THEN substr(r, 1, instr(r, '/') - 1) \
    ELSE r END FROM (SELECT replace(replace(CASE WHEN instr(url, '://') > 0 \
    THEN substr(url, instr(url, '://') + 3) ELSE url END, '?', '/'), '#', '/') AS r))";

/// Where the app's sidebar places a URL: its host, lowercased and without its scheme's default
/// port, then its path's non-empty segments, joined by `/`, as in `api.stripe.com/v1/charges`.
/// A URL without a scheme is a host of its own. `sidebarPath` in the app's `lib/search.ts`
/// follows the same rules, and the sidebar's nodes are built from it.
pub fn sidebar_path(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_string();
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, rest) = rest.split_at(end);
    let mut host = authority.to_ascii_lowercase();
    let default_port = match scheme.to_ascii_lowercase().as_str() {
        "http" | "ws" => Some(":80"),
        "https" | "wss" => Some(":443"),
        _ => None,
    };
    if let Some(port) = default_port
        && host.ends_with(port)
    {
        host.truncate(host.len() - port.len());
    }
    let path = rest.split(['?', '#']).next().unwrap_or_default();
    let mut key = host;
    for segment in path.split('/').filter(|s| !s.is_empty()) {
        key.push('/');
        key.push_str(segment);
    }
    key
}

/// The last part of a directory's path, `fieldwork` for `/Users/me/src/fieldwork`. None for the
/// root, where daemons run, or no path.
pub fn folder_name(path: Option<&str>) -> Option<&str> {
    let name = path?.trim_end_matches('/').rsplit('/').next()?;
    (!name.is_empty()).then_some(name)
}

/// Where macOS keeps its own daemons and tools.
const SYSTEM_DIRS: &[&str] = &[
    "/System/",
    "/usr/libexec/",
    "/usr/sbin/",
    "/sbin/",
    "/Library/Apple/",
];

/// Daemons that are macOS's own wherever they run from.
const SYSTEM_PROGRAMS: &[&str] = &[
    "akd",
    "apsd",
    "cloudd",
    "mDNSResponder",
    "nsurlsessiond",
    "ocspd",
    "softwareupdated",
    "trustd",
];

/// A flow came from one of macOS's own daemons rather than an app or a program someone ran: a
/// process outside an app bundle whose executable is under `/System`, `/usr/libexec` and the
/// like, or one of a few daemons by name. WebKit's helper processes, which also live under
/// `/System`, send apps' traffic and are not. `isSystemFlow` in the app's `lib/search.ts`
/// follows the same rules.
pub fn is_system(bundle_id: Option<&str>, path: Option<&str>) -> bool {
    let Some(path) = path else { return false };
    if bundle_id.is_some() {
        return false;
    }
    let name = path.rsplit('/').next().unwrap_or_default();
    if name.starts_with("com.apple.WebKit.") {
        return false;
    }
    SYSTEM_DIRS.iter().any(|dir| path.starts_with(dir)) || SYSTEM_PROGRAMS.contains(&name)
}

/// The flows `filter` covers, newest first: by start, then by id. Reads the table in that order
/// through its index and stops at the limit, so a page of a common match costs the same however
/// many flows there are.
pub fn list(db: &ProxyQueryManager, filter: &FlowFilter) -> Result<Vec<Flow>, String> {
    db.with_conn(|c| list_in(c.conn().resolve(), filter))
}

/// [`list`] and the count of every flow, read from one snapshot of the database, so the count
/// takes in exactly the flows written before the page was read. With a filter that narrows,
/// also the count of the flows it covers, whatever the limit.
pub fn page(
    db: &ProxyQueryManager,
    filter: &FlowFilter,
) -> Result<(Vec<Flow>, usize, Option<usize>), String> {
    let page = sorted_page(db, filter)?;
    Ok((page.flows, page.total, page.matching))
}

/// A page of flows, as [`page`] reads it, with where a sort's next page starts.
pub struct Page {
    pub flows: Vec<Flow>,
    pub total: usize,
    pub matching: Option<usize>,
    /// The sort values of the last flow, for the next page's `cursor`. None without a sort.
    pub cursor: Option<Vec<SortValue>>,
}

/// [`page`], with the cursor for a sort's next page.
pub fn sorted_page(db: &ProxyQueryManager, filter: &FlowFilter) -> Result<Page, String> {
    db.with_conn(|c| {
        let tx = c.conn().resolve().unchecked_transaction().map_err(|e| e.to_string())?;
        let (flows, cursor) = list_and_cursor(&tx, filter)?;
        let total = count_in(&tx)?;
        let matching = if filter.narrows() { Some(count_matching(&tx, filter)?) } else { None };
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Page { flows, total, matching, cursor })
    })
}

fn list_in(conn: &rusqlite::Connection, filter: &FlowFilter) -> Result<Vec<Flow>, String> {
    list_and_cursor(conn, filter).map(|(flows, _)| flows)
}

/// The flows `filter` covers and, sorted, the sort values of the last one.
fn list_and_cursor(
    conn: &rusqlite::Connection,
    filter: &FlowFilter,
) -> Result<(Vec<Flow>, Option<Vec<SortValue>>), String> {
    let terms = if filter.sort.is_empty() {
        Vec::new()
    } else {
        sort_terms(&filter.sort, &FlowColumns::of(conn))
    };
    // The rowid, for the flow's number, and a sort's values, for its cursor and its order.
    let keys: String =
        terms.iter().enumerate().map(|(i, t)| format!(", {} AS sort_{i}", t.sql)).collect();
    let mut params: Vec<Value> = terms.iter().flat_map(|t| t.params.iter().cloned()).collect();
    let (condition, condition_params) = filter.condition_in(conn);
    params.extend(condition_params);
    let mut sql = format!("SELECT rowid, *{keys} FROM flows WHERE {condition}");
    push_clear_mark(conn, &mut sql, &mut params);
    if let Some(id) = &filter.after {
        // By rowid, which only grows as flows are written.
        let rowid: i64 = conn
            .query_row("SELECT rowid FROM flows WHERE id = ?", [id], |r| r.get(0))
            .map_err(|_| format!("No flow {id}"))?;
        sql.push_str(" AND rowid > ?");
        params.push(rowid.into());
    }
    if !terms.is_empty() {
        if let Some(cursor) = &filter.cursor {
            if cursor.len() != terms.len() {
                return Err("The cursor is not for this sort".into());
            }
            let cursor: Vec<Value> = cursor.iter().map(SortValue::to_sql).collect();
            let (after, after_params) = sort_after(&terms, &cursor);
            sql.push_str(" AND ");
            sql.push_str(&after);
            params.extend(after_params);
        }
        // By the values selected above, so a key with parameters is computed once a row
        let order: Vec<String> = terms
            .iter()
            .enumerate()
            .map(|(i, t)| format!("sort_{i} {}", if t.descending { "DESC" } else { "ASC" }))
            .collect();
        sql.push_str(" ORDER BY ");
        sql.push_str(&order.join(", "));
    } else {
        if let Some(id) = &filter.before {
            let started_at: Value = conn
                .query_row("SELECT started_at FROM flows WHERE id = ?", [id], |r| r.get(0))
                .map_err(|_| format!("No flow {id}"))?;
            sql.push_str(" AND (started_at, id) < (?, ?)");
            params.push(started_at);
            params.push(id.clone().into());
        }
        sql.push_str(" ORDER BY started_at DESC, id DESC");
    }
    if let Some(limit) = filter.limit {
        sql.push_str(" LIMIT ?");
        params.push((limit.min(i64::MAX as usize) as i64).into());
    }
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut cursor = None;
    let mut flows = Vec::new();
    let mut rows = stmt.query(rusqlite::params_from_iter(params)).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        flows.push(Flow::from_row(row).map_err(|e| e.to_string())?);
        if !terms.is_empty() {
            let values = (0..terms.len())
                .map(|i| row.get::<_, Value>(format!("sort_{i}").as_str()).map(SortValue::from_sql))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            cursor = Some(values);
        }
    }
    Ok((flows, cursor))
}

fn count_matching(conn: &rusqlite::Connection, filter: &FlowFilter) -> Result<usize, String> {
    let (condition, mut params) = filter.condition_in(conn);
    let mut sql = format!("SELECT COUNT(*) FROM flows WHERE {condition}");
    push_clear_mark(conn, &mut sql, &mut params);
    conn.query_row(&sql, rusqlite::params_from_iter(params), |r| r.get::<_, i64>(0))
        .map(|n| n as usize)
        .map_err(|e| e.to_string())
}

/// How many flows each filter's search covers, whatever its limit, read from one snapshot.
pub fn count_each(db: &ProxyQueryManager, filters: &[FlowFilter]) -> Result<Vec<usize>, String> {
    db.with_conn(|c| {
        let tx = c.conn().resolve().unchecked_transaction().map_err(|e| e.to_string())?;
        let counts = filters.iter().map(|f| count_matching(&tx, f)).collect::<Result<_, _>>()?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(counts)
    })
}

/// The flows of `ids` that `filter`'s search covers, in any order. Cleared ones are left out.
pub fn matching_ids(
    db: &ProxyQueryManager,
    filter: &FlowFilter,
    ids: &[String],
) -> Result<Vec<String>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let (condition, mut params) = filter.condition_in(conn);
        let marks = vec!["?"; ids.len()].join(", ");
        let mut sql = format!("SELECT id FROM flows WHERE ({condition}) AND id IN ({marks})");
        params.extend(ids.iter().map(|id| Value::from(id.clone())));
        push_clear_mark(conn, &mut sql, &mut params);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params), |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<String>, _>>().map_err(|e| e.to_string())
    })
}

/// Leaves out cleared flows, when a clear is pending; otherwise adds nothing, so SQLite keeps its
/// cheapest plan.
fn push_clear_mark(conn: &rusqlite::Connection, sql: &mut String, params: &mut Vec<Value>) {
    let mark = clear_mark(conn);
    if mark > 0 {
        sql.push_str(" AND rowid > ?");
        params.push(mark.into());
    }
}

/// The rowid at or below which flows are cleared, or 0 when none are waiting to be deleted. 0
/// too for a database from before the mark, read without migrating.
pub fn clear_mark(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT max_rowid FROM flow_clear_mark WHERE id = 1", [], |r| r.get(0))
        .unwrap_or(0)
}

/// Clears every flow at once: marks the newest flow's rowid, so no listing or count sees it or
/// any before it, and leaves the deleting to [`delete_cleared`]. Flows written afterwards are
/// unaffected. Returns how many flows were cleared.
pub fn clear(db: &ProxyQueryManager) -> Result<usize, String> {
    db.with_tx(|c| {
        let conn = c.conn().resolve();
        let mark = clear_mark(conn);
        let (newest, cleared): (Option<i64>, i64) = conn.query_row(
            "SELECT max(rowid), count(*) FROM flows WHERE rowid > ?",
            [mark],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if let Some(newest) = newest {
            conn.execute(
                "INSERT INTO flow_clear_mark (id, max_rowid) VALUES (1, ?) \
                ON CONFLICT (id) DO UPDATE SET max_rowid = excluded.max_rowid",
                [newest],
            )?;
        }
        Ok::<_, yaak_database::Error>(cleared as usize)
    })
    .map_err(|e| format!("Failed to clear flows: {e}"))
}

/// Deletes every flow and message from `proxy.db` in one transaction, with what was left of a
/// clear or sweep, for a launch that starts empty. Saved searches and gRPC schemas stay. Only
/// before anything else writes: unlike [`clear`], flows being written are not spared. Their
/// bodies are in `blobs.sqlite`, which goes whole ([`crate::db::remove_blobs`]).
pub fn delete_all(db: &ProxyQueryManager) -> Result<(), String> {
    db.with_tx(|c| {
        let conn = c.conn().resolve();
        // Unconditional, so SQLite drops each table's pages whole rather than row by row.
        for table in [
            "flow_messages",
            "flows",
            "flow_clear_mark",
            "flow_sweep_pending",
        ] {
            conn.execute(&format!("DELETE FROM {table}"), [])?;
        }
        Ok::<_, yaak_database::Error>(())
    })
    .map_err(|e| format!("Failed to delete captured traffic: {e}"))
}

/// Flows deleted per transaction while deleting cleared ones, so a flow being written never
/// waits long behind it.
pub const DELETE_BATCH: usize = 500;

/// How long a cleaner may go without a batch before another process takes the deleting over.
const CLEANER_LEASE_MS: i64 = 30_000;

/// What a batch of deleting cleared flows left.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cleaned {
    /// More cleared flows wait.
    More,
    /// None are left, and the mark is gone.
    Done,
    /// Another process holds the lease and is deleting them.
    Elsewhere,
}

/// Deletes up to `batch` cleared flows, their messages and their bodies, as `cleaner`, the
/// process's name for itself. Once none are left, removes the mark in the same transaction as
/// the last of them, so a clear that raised it meanwhile is never lost.
///
/// One process deletes at a time, the one holding the mark's lease, which each batch renews:
/// the app and the CLI share the database, and two cleaners could otherwise race. The bodies go
/// first, in their own transaction, and the rows after, so when deleting the bodies fails the
/// flows stay, to be deleted again. The two writers are never held together: a flow being
/// written holds the bodies' while it waits for the flows', and the other order would stall them
/// both.
pub fn delete_cleared(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    batch: usize,
    cleaner: &str,
) -> Result<Cleaned, String> {
    let fail = |e: String| format!("Failed to delete cleared flows: {e}");
    if clear_mark_in(db) == 0 {
        return Ok(Cleaned::Done);
    }
    if !take_lease(db, cleaner).map_err(|e| fail(e.to_string()))? {
        return Ok(Cleaned::Elsewhere);
    }
    let rows = read_cleared(db, batch).map_err(|e| fail(e.to_string()))?;
    // Their bodies and their messages' payloads, by flow, so a flow still in flight keeps what
    // it has written.
    if !rows.is_empty() {
        blobs
            .with_tx(|b| {
                for (_, id) in &rows {
                    b.delete_chunks(&Flow::body_id(id, FlowBody::Request))?;
                    b.delete_chunks(&Flow::body_id(id, FlowBody::Response))?;
                    b.delete_chunks_like(&format!("{id}.msg.%"))?;
                }
                Ok::<_, yaak_models::error::Error>(())
            })
            .map_err(|e| fail(format!("flow bodies: {e}")))?;
    }
    delete_rows(db, &rows, cleaner).map_err(|e| fail(e.to_string()))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Takes or renews the lease on deleting cleared flows for `cleaner`. False while another
/// process holds it, or when nothing is cleared.
fn take_lease(db: &ProxyQueryManager, cleaner: &str) -> Result<bool, yaak_database::Error> {
    db.with_tx(|c| {
        let now = now_ms();
        let taken = c.conn().resolve().execute(
            "UPDATE flow_clear_mark SET cleaner = ?1, cleaner_at = ?2 WHERE id = 1 \
            AND (cleaner IS NULL OR cleaner = ?1 OR cleaner_at IS NULL OR cleaner_at < ?3)",
            rusqlite::params![cleaner, now, now - CLEANER_LEASE_MS],
        )?;
        Ok(taken == 1)
    })
}

/// The next `batch` cleared flows, by rowid and id.
fn read_cleared(db: &ProxyQueryManager, batch: usize) -> rusqlite::Result<Vec<(i64, String)>> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let mut stmt =
            conn.prepare("SELECT rowid, id FROM flows WHERE rowid <= ? ORDER BY rowid LIMIT ?")?;
        stmt.query_map([clear_mark(conn), batch as i64], |r| Ok((r.get(0)?, r.get(1)?)))?.collect()
    })
}

/// Deletes `rows`, read a moment ago, and their messages, while `cleaner` still holds the lease
/// and only those still under the mark with the same id: read since, the mark may be gone and a
/// new flow have the rowid again. Drops the mark once nothing is left under it.
fn delete_rows(
    db: &ProxyQueryManager,
    rows: &[(i64, String)],
    cleaner: &str,
) -> Result<Cleaned, yaak_database::Error> {
    db.with_tx(|c| {
        let conn = c.conn().resolve();
        let held: Option<Option<String>> = conn
            .query_row("SELECT cleaner FROM flow_clear_mark WHERE id = 1", [], |r| r.get(0))
            .ok();
        match held {
            // The mark went meanwhile: a rowid read may be a new flow's now.
            None => return Ok(Cleaned::Done),
            Some(held) if held.as_deref() != Some(cleaner) => return Ok(Cleaned::Elsewhere),
            Some(_) => {}
        }
        let mark = clear_mark(conn);
        let mut delete =
            conn.prepare("DELETE FROM flows WHERE rowid = ? AND id = ? AND rowid <= ?")?;
        let mut delete_messages = conn.prepare("DELETE FROM flow_messages WHERE flow_id = ?")?;
        for (rowid, id) in rows {
            if delete.execute(rusqlite::params![rowid, id, mark])? > 0 {
                delete_messages.execute([id])?;
            }
        }
        // With none left under it, the mark goes in this transaction, since an empty table
        // hands out rowids from 1 again and a new flow would fall under it.
        let left: bool =
            conn.query_row("SELECT EXISTS (SELECT 1 FROM flows WHERE rowid <= ?)", [mark], |r| {
                r.get(0)
            })?;
        if left {
            conn.execute("UPDATE flow_clear_mark SET cleaner_at = ? WHERE id = 1", [now_ms()])?;
            Ok(Cleaned::More)
        } else {
            conn.execute("DELETE FROM flow_clear_mark WHERE id = 1", [])?;
            Ok(Cleaned::Done)
        }
    })
}

/// [`clear_mark`], read from `db`.
pub fn clear_mark_in(db: &ProxyQueryManager) -> i64 {
    db.with_conn(|c| clear_mark(c.conn().resolve()))
}

/// When captured traffic takes more than `cap` bytes, as [`Stores::used_bytes`] counts them,
/// deletes the flows written first, with their bodies and messages: as many as the average flow
/// says would bring it under, from one to [`DELETE_BATCH`]. Returns the ids deleted, none once it
/// is under or no flow is left, so a caller sweeps a batch per call until then. Cleared flows are
/// left to [`delete_cleared`], and a stream still open is never swept: its writer would go on
/// adding messages to it.
pub fn sweep_oldest(stores: &Stores, cap: u64) -> Result<Vec<String>, String> {
    // Bodies a sweep that failed partway left behind go first: they count against the cap.
    let pending = pending_sweeps(stores)?;
    delete_swept_bodies(stores, &pending)?;
    let used = stores.used_bytes()?;
    if used <= cap {
        return Ok(Vec::new());
    }
    let count = count(&stores.db)? as u64;
    if count == 0 {
        return Ok(Vec::new());
    }
    let average = (used / count).max(1);
    let batch = (used - cap).div_ceil(average).clamp(1, DELETE_BATCH as u64);
    let rows = sweepable(stores, batch as usize)?;
    let deleted = delete_swept_rows(stores, rows)?;
    delete_swept_bodies(stores, &deleted)?;
    Ok(deleted)
}

/// Flows whose rows a sweep deleted and whose bodies it may not have, at most a batch of them.
pub(crate) fn pending_sweeps(stores: &Stores) -> Result<Vec<String>, String> {
    stores
        .db
        .with_conn(|c| {
            let conn = c.conn().resolve();
            let mut stmt = conn.prepare("SELECT flow_id FROM flow_sweep_pending LIMIT ?")?;
            stmt.query_map([DELETE_BATCH as i64], |r| r.get(0))?.collect::<rusqlite::Result<_>>()
        })
        .map_err(sweep_failed)
}

/// A stream still open: it has no end yet, and its writer goes on adding messages to it.
const OPEN_STREAM: &str =
    "stream_kind IS NOT NULL AND elapsed_ms IS NULL AND error IS NULL AND NOT cancelled";

/// Fail messages for sweeping, all of a kind.
fn sweep_failed(e: impl std::fmt::Display) -> String {
    format!("Failed to delete the oldest flows: {e}")
}

/// Up to `limit` of the oldest flows that are neither cleared nor an open stream, by rowid.
pub(crate) fn sweepable(stores: &Stores, limit: usize) -> Result<Vec<(i64, String)>, String> {
    stores
        .db
        .with_conn(|c| {
            let conn = c.conn().resolve();
            let mut stmt = conn.prepare(&format!(
                "SELECT rowid, id FROM flows WHERE rowid > ?
                    AND NOT ({OPEN_STREAM})
                    ORDER BY rowid LIMIT ?"
            ))?;
            stmt.query_map(rusqlite::params![clear_mark(conn), limit as i64], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
            .collect::<rusqlite::Result<_>>()
        })
        .map_err(sweep_failed)
}

/// Deletes the flows' rows and their messages' rows in one transaction, first, so nothing
/// written for them after this has an owner left to count under, and records them as pending
/// until their bodies go, so a failure before then is finished by the next sweep. A flow that
/// changed or was cleared since it was chosen is kept. Returns the ids deleted.
pub(crate) fn delete_swept_rows(
    stores: &Stores,
    rows: Vec<(i64, String)>,
) -> Result<Vec<String>, String> {
    stores
        .db
        .with_tx(|c| {
            let conn = c.conn().resolve();
            let mut delete = conn.prepare(&format!(
                "DELETE FROM flows WHERE rowid = ? AND id = ?
                    AND NOT ({OPEN_STREAM})"
            ))?;
            let mut delete_messages =
                conn.prepare("DELETE FROM flow_messages WHERE flow_id = ?")?;
            let mut pending =
                conn.prepare("INSERT OR IGNORE INTO flow_sweep_pending (flow_id) VALUES (?)")?;
            let mut deleted = Vec::with_capacity(rows.len());
            for (rowid, id) in rows {
                if delete.execute(rusqlite::params![rowid, id])? > 0 {
                    delete_messages.execute([&id])?;
                    pending.execute([&id])?;
                    deleted.push(id);
                }
            }
            Ok::<_, yaak_database::Error>(deleted)
        })
        .map_err(sweep_failed)
}

/// Deletes the bodies and message payloads of flows whose rows are gone, then once more the
/// message rows: anything a writer added for them while the rows went is an orphan, which
/// would otherwise go on counting against the cap with nothing to sweep it by. The flows stop
/// being pending once this is done.
pub(crate) fn delete_swept_bodies(stores: &Stores, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    stores
        .blobs
        .with_tx(|b| {
            for id in ids {
                b.delete_chunks(&Flow::body_id(id, FlowBody::Request))?;
                b.delete_chunks(&Flow::body_id(id, FlowBody::Response))?;
                b.delete_chunks_like(&format!("{id}.msg.%"))?;
            }
            Ok::<_, yaak_models::error::Error>(())
        })
        .map_err(|e| sweep_failed(format!("flow bodies: {e}")))?;
    stores
        .db
        .with_tx(|c| {
            let conn = c.conn().resolve();
            let mut orphans = conn.prepare(
                "DELETE FROM flow_messages WHERE flow_id = ?
                    AND NOT EXISTS (SELECT 1 FROM flows WHERE flows.id = flow_messages.flow_id)",
            )?;
            let mut done = conn.prepare("DELETE FROM flow_sweep_pending WHERE flow_id = ?")?;
            for id in ids {
                orphans.execute([id])?;
                done.execute([id])?;
            }
            Ok::<_, yaak_database::Error>(())
        })
        .map_err(sweep_failed)
}

/// A flow by id, with its number. None once it is cleared, though its row may not be deleted
/// yet.
pub fn find(db: &ProxyQueryManager, flow_id: &str) -> Option<Flow> {
    db.with_conn(|c| find_in(c.conn().resolve(), flow_id))
}

/// [`find`], inside a transaction or on a connection already held.
pub fn find_in(conn: &rusqlite::Connection, flow_id: &str) -> Option<Flow> {
    conn.query_row(
        "SELECT rowid, * FROM flows WHERE id = ? AND rowid > ?",
        rusqlite::params![flow_id, clear_mark(conn)],
        Flow::from_row,
    )
    .ok()
}

pub fn get(db: &ProxyQueryManager, flow_id: &str) -> Result<Flow, String> {
    find(db, flow_id).ok_or_else(|| format!("No flow {flow_id}"))
}

/// The hosts and apps flows have gone to and come from, for the decrypt list's suggestions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SeenTargets {
    /// Hosts as the sidebar names them, with a port other than the scheme's: most recent first.
    pub hosts: Vec<String>,
    /// Apps by name and bundle id, most recent first.
    pub apps: Vec<SeenApp>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SeenApp {
    pub name: String,
    pub bundle_id: Option<String>,
}

/// Distinct hosts and apps listed by [`seen`] at most.
const SEEN_LIMIT: i64 = 1000;

/// The distinct hosts and apps of the flows not cleared, most recent first, up to
/// [`SEEN_LIMIT`] of each.
pub fn seen(db: &ProxyQueryManager) -> Result<SeenTargets, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let mut params: Vec<Value> = Vec::new();
        let mut cleared = String::new();
        push_clear_mark(conn, &mut cleared, &mut params);
        params.push(SEEN_LIMIT.into());
        // The newest flow of each host, whose URL names it as the sidebar does.
        let sql = format!(
            "SELECT url FROM flows WHERE rowid IN (SELECT max(rowid) FROM flows WHERE 1{cleared} \
            GROUP BY lower({HOST_SQL})) ORDER BY rowid DESC LIMIT ?"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let urls = stmt
            .query_map(rusqlite::params_from_iter(params.clone()), |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut hosts: Vec<String> = Vec::new();
        for url in urls {
            let path = sidebar_path(&url);
            let host = path.split('/').next().unwrap_or_default().to_string();
            if !host.is_empty() && !hosts.contains(&host) {
                hosts.push(host);
            }
        }

        let sql = format!(
            "SELECT client_name, client_bundle_id FROM flows WHERE client_name IS NOT NULL{cleared} \
            GROUP BY client_name, client_bundle_id ORDER BY max(rowid) DESC LIMIT ?"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let apps = stmt
            .query_map(rusqlite::params_from_iter(params), |r| {
                Ok(SeenApp { name: r.get(0)?, bundle_id: r.get(1)? })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(SeenTargets { hosts, apps })
    })
}

pub fn count(db: &ProxyQueryManager) -> Result<usize, String> {
    db.with_conn(|c| count_in(c.conn().resolve()))
}

fn count_in(conn: &rusqlite::Connection) -> Result<usize, String> {
    // Without a clear pending, SQLite counts over its smallest index rather than the table.
    let mark = clear_mark(conn);
    let count = if mark == 0 {
        conn.query_row("SELECT COUNT(*) FROM flows", [], |r| r.get::<_, i64>(0))
    } else {
        conn.query_row("SELECT COUNT(*) FROM flows WHERE rowid > ?", [mark], |r| r.get(0))
    };
    count.map(|n| n as usize).map_err(|e| e.to_string())
}

/// A body in JSON: text when it is UTF-8, base64 when it is not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyPreview {
    pub data: String,
    pub encoding: BodyEncoding,
    /// Bytes in `data` once decoded.
    pub size: usize,
    /// The body is longer than `data`: cut at the capture limit or at the preview cap.
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BodyEncoding {
    Utf8,
    Base64,
}

impl BodyPreview {
    pub fn new(data: &[u8], truncated: bool) -> Self {
        let (data, encoding) = match std::str::from_utf8(data) {
            Ok(text) => (text.to_string(), BodyEncoding::Utf8),
            // A cut can split a character; that alone does not make the body binary.
            Err(e) if truncated && e.error_len().is_none() => {
                (String::from_utf8_lossy(&data[..e.valid_up_to()]).into_owned(), BodyEncoding::Utf8)
            }
            Err(_) => (BASE64.encode(data), BodyEncoding::Base64),
        };
        let size = match encoding {
            BodyEncoding::Utf8 => data.len(),
            BodyEncoding::Base64 => BASE64.decode(&data).map(|d| d.len()).unwrap_or_default(),
        };
        Self { data, encoding, size, truncated }
    }
}

/// One flow with its bodies, each decoded and cut at `body_cap` bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowDetail {
    pub flow: Flow,
    pub request_body: Option<BodyPreview>,
    pub response_body: Option<BodyPreview>,
}

pub async fn detail(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    flow_id: &str,
    body_cap: usize,
) -> Result<FlowDetail, String> {
    let flow = get(db, flow_id)?;
    let request_body = preview(db, blobs, &flow, FlowBody::Request, body_cap).await?;
    let response_body = preview(db, blobs, &flow, FlowBody::Response, body_cap).await?;
    Ok(FlowDetail { flow, request_body, response_body })
}

async fn preview(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    flow: &Flow,
    which: FlowBody,
    cap: usize,
) -> Result<Option<BodyPreview>, String> {
    let body = bodies::read_body(db, blobs, flow, which, cap).await?;
    if body.data.is_empty() && !body.truncated {
        return Ok(None);
    }
    Ok(Some(BodyPreview::new(&body.data, body.truncated)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flow(url: &str, method: &str, status: Option<i32>, error: Option<&str>) -> Flow {
        Flow {
            url: url.into(),
            method: method.into(),
            status,
            error: error.map(String::from),
            ..Default::default()
        }
    }

    /// A database of `flows`, started a second apart in the order given, and a function that
    /// lists the urls a filter covers, newest first.
    fn db_of(flows: Vec<Flow>) -> (tempfile::TempDir, ProxyQueryManager) {
        use yaak_database::UpdateSource;
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        for (i, flow) in flows.into_iter().enumerate() {
            let started_at = chrono::DateTime::from_timestamp(i as i64, 0).unwrap().naive_utc();
            let flow = Flow { id: format!("fl_{i:03}"), started_at, ..flow };
            db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        }
        (dir, db)
    }

    fn urls(db: &ProxyQueryManager, filter: FlowFilter) -> Vec<String> {
        list(db, &filter).unwrap().into_iter().map(|f| f.url).collect()
    }

    /// The urls a search covers, sorted.
    fn found(db: &ProxyQueryManager, query: &str) -> Vec<String> {
        let mut found = urls(db, FlowFilter::search(query));
        found.sort();
        found
    }

    #[test]
    fn filters() {
        let (_dir, db) = db_of(vec![
            flow("https://api.stripe.com:8443/v1/charges?x=1", "POST", Some(200), None),
            flow("http://example.com/missing", "GET", Some(404), None),
            flow("https://down.example.com/", "GET", None, Some("refused")),
        ]);
        let by = |query: &str| urls(&db, FlowFilter::search(query)).len();
        assert_eq!(urls(&db, FlowFilter::default()).len(), 3);
        // A host whole, with or without its port; a part of one with wildcards.
        assert_eq!(by("@host:API.STRIPE.COM"), 1);
        assert_eq!(by("@host:api.stripe.com:8443"), 1);
        assert_eq!(by("@host:stripe"), 0);
        assert_eq!(by("@host:*stripe*"), 1);
        assert_eq!(by("@host:*.example.com"), 2);
        assert_eq!(by("@method:get"), 2);
        assert_eq!(by("@status:404"), 1);
        assert_eq!(by("@status:2xx"), 1);
        assert_eq!(by("@status:5XX"), 0);
        assert_eq!(by("@status:40"), 0);
        assert_eq!(by("@is:error"), 1);
    }

    #[test]
    fn search_matches_url_method_status_and_content_type() {
        let json = |url: &str, method: &str, status| Flow {
            content_type: Some("application/json; charset=utf-8".into()),
            ..flow(url, method, Some(status), None)
        };
        let (_dir, db) = db_of(vec![
            json("https://api.stripe.com/v1/charges?customer=cus_9", "POST", 200),
            json("https://api.github.com/repos/yaak", "GET", 404),
            Flow {
                content_type: Some("image/png".into()),
                ..flow("https://images.ctfassets.net/logo.png", "GET", Some(200), None)
            },
            flow("http://localhost:3000/health", "HEAD", Some(503), None),
        ]);
        let search = |q: &str| found(&db, q);
        let stripe = "https://api.stripe.com/v1/charges?customer=cus_9";
        let github = "https://api.github.com/repos/yaak";
        let logo = "https://images.ctfassets.net/logo.png";
        let health = "http://localhost:3000/health";
        // The host, the path and the query, any case.
        assert_eq!(search("STRIPE"), vec![stripe]);
        assert_eq!(search("/repos/"), vec![github]);
        assert_eq!(search("cus_9"), vec![stripe]);
        // The method and the status, any part of them.
        assert_eq!(search("head"), vec![health]);
        assert_eq!(search("ead"), vec![health]);
        assert_eq!(search("404"), vec![github]);
        assert_eq!(search("50"), vec![health]);
        // The content type.
        assert_eq!(search("png"), vec![logo]);
        assert_eq!(search("json"), vec![github, stripe]);
        // Every term must match, each anywhere.
        assert_eq!(search("json get"), vec![github]);
        assert_eq!(search("  json   @status:2xx "), vec![stripe]);
        assert_eq!(search("json @status:5xx"), Vec::<&str>::new());
        // `%` and `_` are plain characters, not patterns.
        assert_eq!(search("%"), Vec::<&str>::new());
        assert_eq!(search("cus_"), vec![stripe]);
        assert_eq!(search(""), vec![health, github, stripe, logo]);
    }

    /// The terms a sidebar row writes cover what is under it: a host, with any port, and a
    /// path with what is below it.
    #[test]
    fn hosts_and_paths_as_the_sidebar_writes_them() {
        let (_dir, db) = db_of(vec![
            flow("https://api.stripe.com/v1/charges", "GET", Some(200), None),
            flow("https://api.stripe.com/v1/charges/ch_1?expand=x", "GET", Some(200), None),
            flow("https://api.stripe.com/v1/chargesx", "GET", Some(200), None),
            flow("https://api.stripe.com:8443/v1/charges", "GET", Some(200), None),
            flow("http://api.stripe.com", "GET", Some(200), None),
            flow("https://api.stripe.community/", "GET", Some(200), None),
            flow("http://x.com:80/a", "GET", Some(200), None),
            flow("https://x.com:443/a", "GET", Some(200), None),
            flow("https://example.com/v1//users", "GET", Some(200), None),
        ]);
        let count = |query: &str| found(&db, query).len();
        assert_eq!(count("@host:api.stripe.com"), 5);
        assert_eq!(count("@host:api.stripe.com:8443"), 1);
        assert_eq!(count("@host:api.stripe.com @path:/v1/charges/*"), 3);
        assert_eq!(count("@host:x.com @path:/a"), 2);
        assert_eq!(count("@host:api.stripe.com @path:/v1/charges/* OR @host:x.com"), 5);
        assert_eq!(count("@host:API.stripe.com @path:/V1/charges/*"), 3);
        // A path with empty segments is found by the sidebar's row for it.
        assert_eq!(count("@host:example.com @path:/v1/users/*"), 1);
    }

    /// The cases `lib/search.test.ts` checks `sidebarPath` against, so the two agree.
    /// A search with `OR` at its top still pages and leaves out cleared flows.
    #[test]
    fn a_top_level_or_keeps_to_the_page_and_the_clear() {
        let (_dir, db) = db_of(vec![
            flow("https://a.com/1", "GET", Some(200), None),
            flow("https://a.com/2", "GET", Some(404), None),
            flow("https://a.com/3", "GET", Some(200), None),
        ]);
        let query = "@status:200 OR @status:404";
        let before = FlowFilter { before: Some("fl_001".into()), ..FlowFilter::search(query) };
        assert_eq!(urls(&db, before), vec!["https://a.com/1"]);
        clear(&db).unwrap();
        assert!(urls(&db, FlowFilter::search(query)).is_empty());
        assert_eq!(page(&db, &FlowFilter::search(query)).unwrap().2, Some(0));
    }

    #[test]
    fn sidebar_path_rules() {
        for (url, path) in [
            ("https://example.com/v1//users", "example.com/v1/users"),
            ("http://x.com:80/a", "x.com/a"),
            ("https://x.com:443/a?q=1#f", "x.com/a"),
            ("http://x.com:443/a", "x.com:443/a"),
            ("https://API.Stripe.com:8443/", "api.stripe.com:8443"),
            ("https://api.stripe.com", "api.stripe.com"),
            ("https://api.stripe.com?x=/y", "api.stripe.com"),
            ("http://[::1]:80/a/B", "[::1]/a/B"),
            ("/api", "/api"),
        ] {
            assert_eq!(sidebar_path(url), path, "{url}");
        }
    }

    #[test]
    fn app_matches_a_bundle_id_or_a_path() {
        let from = |bundle_id: Option<&str>, path: &str| Flow {
            client_bundle_id: bundle_id.map(String::from),
            client_path: Some(path.into()),
            ..flow("https://example.com/", "GET", Some(200), None)
        };
        let (_dir, db) = db_of(vec![
            from(Some("com.google.Chrome"), "/Applications/Google Chrome.app"),
            from(Some("com.google.Chrome"), "/Applications/Google Chrome.app"),
            from(None, "/usr/bin/curl"),
            flow("https://example.com/", "GET", Some(200), None),
        ]);
        let app = |query: &str| found(&db, query).len();
        assert_eq!(app("@app:com.google.Chrome"), 2);
        assert_eq!(app("@app:/usr/bin/curl"), 1);
        assert_eq!(app("@app:\"/Applications/Google Chrome.app\""), 0);
        assert_eq!(app("@app:com.google.Chrome OR @app:/usr/bin/curl"), 3);
    }

    /// A program in a folder: its working directory by the whole path, or its folder's name,
    /// any case, along with whatever else the search asks.
    #[test]
    fn cwd_matches_a_path_or_a_folder_name() {
        let node_in = |cwd: Option<&str>| Flow {
            client_name: Some("node".into()),
            client_path: Some("/usr/local/bin/node".into()),
            client_cwd: cwd.map(String::from),
            ..flow("https://example.com/", "GET", Some(200), None)
        };
        let (_dir, db) = db_of(vec![
            node_in(Some("/Users/ada/Workspace/fieldwork")),
            node_in(Some("/Users/ada/Workspace/fieldwork")),
            node_in(Some("/Users/ada/Workspace/Ledger")),
            node_in(None),
            Flow { client_cwd: Some("/tmp/fieldwork".into()), ..node_in(None) },
            Flow { client_path: Some("/usr/bin/curl".into()), ..node_in(Some("/tmp/ledger")) },
        ]);
        let count = |query: &str| found(&db, query).len();
        assert_eq!(count("@cwd:/Users/ada/Workspace/fieldwork"), 2, "the whole path");
        assert_eq!(count("@cwd:/users/ada/workspace/fieldwork"), 2, "any case");
        assert_eq!(count("@cwd:FieldWork"), 3, "a folder name");
        assert_eq!(count("@cwd:fieldwork OR @cwd:ledger"), 5, "any of them");
        assert_eq!(count("@app:/usr/local/bin/node @cwd:ledger"), 1, "and the program");
        assert_eq!(count("@app:/usr/bin/curl @cwd:ledger"), 1);
        assert_eq!(count("@cwd:work"), 0, "whole");
    }

    #[test]
    fn a_search_pages_back_and_counts_what_it_matches() {
        // Every third flow is a POST, newest last.
        let (_dir, db) = db_of(
            (0..30)
                .map(|i| {
                    let method = if i % 3 == 0 { "POST" } else { "GET" };
                    flow(&format!("https://api.example.com/{i}"), method, Some(200), None)
                })
                .collect(),
        );
        let search = |before: Option<String>| FlowFilter {
            query: Some("post".into()),
            before,
            limit: Some(4),
            ..Default::default()
        };
        let (first, total, matching) = page(&db, &search(None)).unwrap();
        let ids = |flows: &[Flow]| flows.iter().map(|f| f.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&first), vec!["fl_027", "fl_024", "fl_021", "fl_018"]);
        assert_eq!((total, matching), (30, Some(10)));
        let (second, _, _) = page(&db, &search(Some("fl_018".into()))).unwrap();
        assert_eq!(ids(&second), vec!["fl_015", "fl_012", "fl_009", "fl_006"]);
        let (last, _, _) = page(&db, &search(Some("fl_006".into()))).unwrap();
        assert_eq!(ids(&last), vec!["fl_003", "fl_000"]);
        // Without a narrowing filter there is nothing more to count.
        let (_, _, matching) =
            page(&db, &FlowFilter { limit: Some(1), ..Default::default() }).unwrap();
        assert_eq!(matching, None);
    }

    /// A sort on several columns orders by each in turn, text without regard to case, empty
    /// values lowest and start as the last tiebreak, and pages through that order from a cursor.
    #[test]
    fn a_sort_on_several_columns_pages_in_its_order() {
        let (_dir, db) = db_of(vec![
            flow("https://B.com/x", "GET", Some(200), None),
            flow("https://a.com/y", "GET", Some(404), None),
            flow("https://a.com/z", "GET", None, None),
            flow("https://c.com/", "GET", Some(200), None),
            flow("https://a.com/", "GET", None, Some("boom")),
            flow("https://b.com/q", "GET", Some(200), None),
            flow("https://A.com/", "GET", Some(404), None),
            flow("https://c.com/", "GET", Some(200), None),
        ]);
        let key =
            |column: SortColumn, descending| FlowSortKey { column: column.into(), descending };
        let read = |sort: &[FlowSortKey], cursor: Option<Vec<SortValue>>, limit| {
            let filter = FlowFilter {
                sort: sort.to_vec(),
                cursor,
                limit: Some(limit),
                ..Default::default()
            };
            let page = sorted_page(&db, &filter).unwrap();
            let ids: Vec<String> = page.flows.iter().map(|f| f.id[3..].to_string()).collect();
            (ids, page.cursor)
        };
        let sorted = |sort: &[FlowSortKey]| read(sort, None, 100).0;
        let by_status = [key(SortColumn::Status, true), key(SortColumn::Host, false)];
        let all = sorted(&by_status);
        assert_eq!(all, ["001", "006", "000", "005", "003", "007", "004", "002"]);
        let mut paged: Vec<String> = Vec::new();
        let mut cursor = None;
        loop {
            let (page, next) = read(&by_status, cursor.clone(), 3);
            if page.is_empty() {
                break;
            }
            cursor = next;
            paged.extend(page);
        }
        assert_eq!(paged, all);

        // The last flow of a page changing does not move where the next page starts.
        let (first, cursor) = read(&by_status, None, 3);
        assert_eq!(first, ["001", "006", "000"]);
        db.with_conn(|c| {
            c.conn().resolve().execute("UPDATE flows SET status = 100 WHERE id = 'fl_000'", [])
        })
        .unwrap();
        let (next, _) = read(&by_status, cursor, 3);
        assert_eq!(next, ["005", "003", "007"]);

        let ascending = [key(SortColumn::Status, false), key(SortColumn::Host, false)];
        assert_eq!(sorted(&ascending), ["002", "004", "000", "005", "003", "007", "001", "006"]);

        // Query alone: the flows without one first, in start order.
        let all = sorted(&[key(SortColumn::Query, true)]);
        assert_eq!(all, ["000", "001", "002", "003", "004", "005", "006", "007"]);
    }

    /// Flows and the order each sort lists them in, shared with the app's `lib/columns.test.ts`,
    /// whose in-memory sort must agree with the database's.
    #[derive(Deserialize)]
    struct SortFixture {
        flows: Vec<Flow>,
        sorts: Vec<SortCase>,
    }

    #[derive(Deserialize)]
    struct SortCase {
        sort: Vec<FlowSortKey>,
        order: Vec<usize>,
    }

    /// A custom column sorts by the value it shows: a header's first value, the response's over
    /// the request's for `header.`, or a query parameter's, as text without regard to case and
    /// empty lowest; alone, after a built-in key or before another, and paged from a cursor.
    #[test]
    fn a_custom_column_sorts_by_its_value_and_pages() {
        let fixture: SortFixture =
            serde_json::from_str(include_str!("../tests/fixtures/custom_column_sort.json"))
                .unwrap();
        let (_dir, db) = db_of(fixture.flows);
        let read = |sort: &[FlowSortKey], cursor: Option<Vec<SortValue>>, limit| {
            let filter = FlowFilter {
                sort: sort.to_vec(),
                cursor,
                limit: Some(limit),
                ..Default::default()
            };
            let page = sorted_page(&db, &filter).unwrap();
            let order: Vec<usize> = page.flows.iter().map(|f| f.id[3..].parse().unwrap()).collect();
            (order, page.cursor)
        };
        for case in &fixture.sorts {
            let (all, _) = read(&case.sort, None, 100);
            assert_eq!(all, case.order, "{:?}", case.sort);
            let mut paged = Vec::new();
            let mut cursor = None;
            loop {
                let (page, next) = read(&case.sort, cursor.clone(), 3);
                if page.is_empty() {
                    break;
                }
                cursor = next;
                paged.extend(page);
            }
            assert_eq!(paged, case.order, "paged {:?}", case.sort);
        }
    }

    /// A custom column's key names it as the app does, `field:` and its path, and takes only
    /// the paths a custom column can have.
    #[test]
    fn a_sort_key_names_a_custom_column_by_its_path() {
        let parse = |column: &str| {
            serde_json::from_value::<FlowSortKey>(
                serde_json::json!({ "column": column, "descending": false }),
            )
            .map(|k| k.column)
        };
        assert_eq!(parse("status").unwrap(), SortBy::Column(SortColumn::Status));
        let field = parse("field:Res.Header.X-Cache").unwrap();
        assert_eq!(serde_json::to_value(&field).unwrap(), "field:res.header.x-cache");
        assert_eq!(serde_json::to_value(parse("tls").unwrap()).unwrap(), "tls");
        for path in [
            "field:host",
            "field:header.",
            "field:header.a b",
            "field:header.a.b",
            "field:query.x'); DROP TABLE flows; --",
            "field:query.filter[status]",
            "nope",
        ] {
            assert!(parse(path).is_err(), "{path}");
        }
    }

    #[test]
    fn a_search_reads_the_newest_page_through_the_index() {
        let (_dir, db) = db_of(vec![]);
        let plan: Vec<String> = db.with_conn(|c| {
            let conn = c.conn().resolve();
            let (condition, params) = FlowFilter::search("stripe @status:>=400").condition_in(conn);
            let sql = format!(
                "EXPLAIN QUERY PLAN SELECT * FROM flows WHERE {condition} \
                ORDER BY started_at DESC, id DESC LIMIT 500"
            );
            let mut stmt = conn.prepare(&sql).unwrap();
            stmt.query_map(rusqlite::params_from_iter(params), |r| r.get::<_, String>(3))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        });
        assert!(plan.iter().any(|p| p.contains("idx_flows_started_at_id")), "{plan:?}");
        assert!(!plan.iter().any(|p| p.contains("TEMP B-TREE")), "{plan:?}");
    }

    #[test]
    fn after_follows_flows_as_they_are_recorded() {
        use yaak_database::UpdateSource;
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        let at = |s| chrono::DateTime::from_timestamp(s, 0).unwrap().naive_utc();
        // A slow flow that started first but ended, and so was written, after a quick one.
        for (id, started) in [("fl_quick", 20), ("fl_slow", 10), ("fl_next", 30)] {
            let flow = Flow { id: id.into(), started_at: at(started), ..Default::default() };
            db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        }

        let after = |id: &str| {
            let filter = FlowFilter { after: Some(id.into()), ..Default::default() };
            list(&db, &filter).unwrap().into_iter().map(|f| f.id).collect::<Vec<_>>()
        };
        assert_eq!(after("fl_quick"), vec!["fl_next", "fl_slow"]);
        assert_eq!(after("fl_next"), Vec::<String>::new());
        let missing = FlowFilter { after: Some("fl_gone".into()), ..Default::default() };
        assert_eq!(list(&db, &missing).unwrap_err(), "No flow fl_gone");
    }

    #[test]
    fn before_pages_back_through_older_flows() {
        use yaak_database::UpdateSource;
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        let at = |s| chrono::DateTime::from_timestamp(s, 0).unwrap().naive_utc();
        // Two started together, which their ids order.
        for (id, started) in [
            ("fl_a", 10),
            ("fl_b", 20),
            ("fl_c", 20),
            ("fl_d", 30),
            ("fl_e", 40),
        ] {
            let flow = Flow {
                id: id.into(),
                started_at: at(started),
                status: Some(if id == "fl_c" { 404 } else { 200 }),
                ..Default::default()
            };
            db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        }

        let page = |filter: FlowFilter| {
            list(&db, &filter).unwrap().into_iter().map(|f| f.id).collect::<Vec<_>>()
        };
        let newest = FlowFilter { limit: Some(2), ..Default::default() };
        assert_eq!(page(newest), vec!["fl_e", "fl_d"]);
        let older =
            FlowFilter { before: Some("fl_d".into()), limit: Some(2), ..Default::default() };
        assert_eq!(page(older), vec!["fl_c", "fl_b"]);
        let oldest =
            FlowFilter { before: Some("fl_b".into()), limit: Some(2), ..Default::default() };
        assert_eq!(page(oldest), vec!["fl_a"]);
        // The limit counts flows the filter keeps.
        let ok = FlowFilter {
            before: Some("fl_e".into()),
            query: Some("@status:2xx".into()),
            limit: Some(2),
            ..Default::default()
        };
        assert_eq!(page(ok), vec!["fl_d", "fl_b"]);
        let missing = FlowFilter { before: Some("fl_gone".into()), ..Default::default() };
        assert_eq!(list(&db, &missing).unwrap_err(), "No flow fl_gone");
    }

    #[test]
    fn clear_marks_flows_then_deletes_them_in_batches() {
        use yaak_database::UpdateSource;
        use yaak_models::blob_manager::BodyChunkWriter;
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        let blobs = crate::db::open_blobs(&dir.path().join("blobs.sqlite"), &crate::db::test_key())
            .unwrap();
        let write_body = |id: &str, which| {
            let mut writer = BodyChunkWriter::new(blobs.clone(), Flow::body_id(id, which));
            writer.write(b"body").unwrap();
            writer.finish().unwrap();
        };
        let write_flow = |id: &str| {
            write_body(id, FlowBody::Request);
            write_body(id, FlowBody::Response);
            let flow = Flow { id: id.into(), ..Default::default() };
            db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        };
        let rows = || {
            db.with_conn(|c| {
                c.conn()
                    .resolve()
                    .query_row("SELECT count(*) FROM flows", [], |r| r.get::<_, i64>(0))
                    .unwrap()
            })
        };
        let ids = |filter: &FlowFilter| -> Vec<String> {
            list(&db, filter).unwrap().into_iter().map(|f| f.id).collect()
        };
        for id in ["fl_a", "fl_b", "fl_c"] {
            write_flow(id);
        }
        // A flow still in flight has written a body but not its row.
        write_body("fl_live", FlowBody::Request);

        // Cleared at once: no listing, count or lookup sees them, though their rows remain.
        assert_eq!(clear(&db).unwrap(), 3);
        assert_eq!(count(&db).unwrap(), 0);
        assert_eq!(ids(&FlowFilter::default()), Vec::<String>::new());
        assert!(find(&db, "fl_a").is_none());
        assert_eq!(rows(), 3);
        assert_eq!(db.with_conn(|c| clear_mark(c.conn().resolve())), 3);

        // A flow written after the clear is unaffected, and a second clear takes only it.
        write_flow("fl_d");
        assert_eq!(ids(&FlowFilter::default()), vec!["fl_d"]);
        assert_eq!(find(&db, "fl_d").map(|f| f.number), Some(4));
        let narrowed = FlowFilter::search("example");
        assert_eq!(page(&db, &narrowed).unwrap().1, 1);

        // Bodies that fail to delete keep their flows, to delete again.
        let read_only = crate::db::open_blobs_read_only(
            &dir.path().join("blobs.sqlite"),
            Some(&crate::db::test_key()),
        )
        .unwrap();
        assert!(delete_cleared(&db, &read_only, 2, "cln_a").is_err());
        assert_eq!(rows(), 4);

        // In batches, the mark going with the last of them.
        assert_eq!(delete_cleared(&db, &blobs, 2, "cln_a"), Ok(Cleaned::More));
        assert_eq!(rows(), 2);
        assert_eq!(delete_cleared(&db, &blobs, 2, "cln_a"), Ok(Cleaned::Done));
        assert_eq!(rows(), 1);
        assert_eq!(db.with_conn(|c| clear_mark(c.conn().resolve())), 0);
        assert_eq!(ids(&FlowFilter::default()), vec!["fl_d"]);
        let mut body_ids = blobs.connect().list_body_ids().unwrap();
        body_ids.sort();
        assert_eq!(
            body_ids,
            vec![
                Flow::body_id("fl_d", FlowBody::Request),
                Flow::body_id("fl_d", FlowBody::Response),
                Flow::body_id("fl_live", FlowBody::Request),
            ]
        );

        assert_eq!(clear(&db).unwrap(), 1);
        assert_eq!(clear(&db).unwrap(), 0);
        assert_eq!(delete_cleared(&db, &blobs, DELETE_BATCH, "cln_a"), Ok(Cleaned::Done));
        assert_eq!(rows(), 0);

        // An empty table numbers from 1 again, which no stale mark may hide.
        write_flow("fl_e");
        assert_eq!(ids(&FlowFilter::default()), vec!["fl_e"]);
        assert_eq!(delete_cleared(&db, &blobs, DELETE_BATCH, "cln_a"), Ok(Cleaned::Done));
        assert_eq!(rows(), 1);
    }

    #[test]
    fn one_cleaner_at_a_time_and_never_a_reused_rowid() {
        use yaak_database::UpdateSource;
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        let blobs = crate::db::open_blobs(&dir.path().join("blobs.sqlite"), &crate::db::test_key())
            .unwrap();
        let write_flow = |id: &str| {
            let flow = Flow { id: id.into(), ..Default::default() };
            db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap().0
        };
        let rows = || -> Vec<String> {
            db.with_conn(|c| {
                let conn = c.conn().resolve();
                let mut stmt = conn.prepare("SELECT id FROM flows ORDER BY rowid").unwrap();
                stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
            })
        };
        for id in ["fl_a", "fl_b", "fl_c"] {
            write_flow(id);
        }
        assert_eq!(clear(&db).unwrap(), 3);

        // The app takes the lease; the CLI, sharing the database, leaves the deleting to it.
        assert_eq!(delete_cleared(&db, &blobs, 1, "cln_app"), Ok(Cleaned::More));
        assert_eq!(delete_cleared(&db, &blobs, 1, "cln_cli"), Ok(Cleaned::Elsewhere));
        assert_eq!(rows(), vec!["fl_b", "fl_c"]);

        // A lease gone stale passes to the next cleaner.
        let exec = |sql: &str| {
            db.with_tx(|c| Ok::<_, yaak_database::Error>(c.conn().resolve().execute(sql, [])?))
                .unwrap()
        };
        exec("UPDATE flow_clear_mark SET cleaner_at = 0");
        assert_eq!(delete_cleared(&db, &blobs, 1, "cln_cli"), Ok(Cleaned::More));
        assert_eq!(delete_cleared(&db, &blobs, 1, "cln_app"), Ok(Cleaned::Elsewhere));

        // A batch read before the last one finished: by then the mark is gone, the table empty,
        // and a new flow has the same rowid as the one read. It is not deleted.
        let stale = read_cleared(&db, DELETE_BATCH).unwrap();
        assert_eq!(stale.iter().map(|(_, id)| id.as_str()).collect::<Vec<_>>(), vec!["fl_c"]);
        assert_eq!(delete_cleared(&db, &blobs, DELETE_BATCH, "cln_cli"), Ok(Cleaned::Done));
        exec(&format!("INSERT INTO flows (rowid, id) VALUES ({}, 'fl_new')", stale[0].0));
        assert_eq!(delete_rows(&db, &stale, "cln_cli").unwrap(), Cleaned::Done);
        assert_eq!(rows(), vec!["fl_new"]);

        // Under a new mark, the same rowid with another id is not the flow read either.
        assert_eq!(clear(&db).unwrap(), 1);
        exec("UPDATE flow_clear_mark SET cleaner = 'cln_cli'");
        assert_eq!(delete_rows(&db, &stale, "cln_cli").unwrap(), Cleaned::More);
        assert_eq!(rows(), vec!["fl_new"]);
    }

    #[test]
    fn numbers_flows_by_rowid_and_keeps_it_on_update() {
        use yaak_database::UpdateSource;
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        let write = |flow: &Flow| db.with_tx(|tx| tx.upsert(flow, &UpdateSource::Background));
        let (a, _) = write(&Flow { id: "fl_a".into(), ..Default::default() }).unwrap();
        let (b, _) = write(&Flow { id: "fl_b".into(), ..Default::default() }).unwrap();
        assert_eq!((a.number, b.number), (1, 2));
        let (a, created) = write(&Flow { status: Some(200), ..a }).unwrap();
        assert_eq!((a.number, created), (1, false));
        let numbers: Vec<i64> =
            list(&db, &FlowFilter::default()).unwrap().iter().map(|f| f.number).collect();
        assert_eq!(numbers, vec![2, 1]);
        assert_eq!(find(&db, "fl_b").map(|f| f.number), Some(2));
    }

    #[test]
    fn filters_by_app_name_folder_site_and_system() {
        use yaak_database::UpdateSource;
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        let flows = [
            Flow {
                id: "fl_slack".into(),
                url: "https://edgeapi.slack.com/cache".into(),
                client_name: Some("Slack".into()),
                client_bundle_id: Some("com.tinyspeck.slackmacgap".into()),
                client_path: Some("/Applications/Slack.app".into()),
                ..Default::default()
            },
            Flow {
                id: "fl_node".into(),
                url: "https://api.github.com:443/repos".into(),
                client_name: Some("node".into()),
                client_path: Some("/opt/homebrew/bin/node".into()),
                client_cwd: Some("/Users/me/src/fieldwork".into()),
                ..Default::default()
            },
            Flow {
                id: "fl_daemon".into(),
                url: "https://github.com/login".into(),
                client_name: Some("nsurlsessiond".into()),
                client_path: Some("/usr/libexec/nsurlsessiond".into()),
                client_cwd: Some("/".into()),
                ..Default::default()
            },
            Flow {
                id: "fl_none".into(),
                url: "http://notgithub.com/".into(),
                ..Default::default()
            },
        ];
        for flow in &flows {
            db.with_tx(|tx| tx.upsert(flow, &UpdateSource::Background)).unwrap();
        }
        let ids = |filter: FlowFilter| -> Vec<String> {
            let mut ids: Vec<String> =
                list(&db, &filter).unwrap().into_iter().map(|f| f.id).collect();
            ids.sort();
            ids
        };
        let ids = |query: &str| ids(FlowFilter::search(query));
        assert_eq!(ids("@app:slack"), vec!["fl_slack"]);
        assert_eq!(ids("@app:com.tinyspeck.slackmacgap"), vec!["fl_slack"]);
        assert_eq!(ids("@app:Fieldwork"), vec!["fl_node"]);
        assert_eq!(ids("@app:/opt/homebrew/bin/node"), vec!["fl_node"]);
        assert_eq!(ids("@host:*.github.com"), vec!["fl_daemon", "fl_node"]);
        assert_eq!(ids("@host:api.github.com"), vec!["fl_node"]);
        assert_eq!(ids("@is:system"), vec!["fl_daemon"]);
        assert_eq!(ids("-@is:system"), vec!["fl_node", "fl_none", "fl_slack"]);

        // Groups, as two sidebar rows under different apps write them, each judged whole:
        // flattened, the apps and hosts would pair across rows and match both flows.
        let crossed = "@app:fieldwork @host:github.com OR @app:nsurlsessiond @host:api.github.com";
        assert_eq!(ids(crossed), Vec::<String>::new());
        assert_eq!(page(&db, &FlowFilter::search(crossed)).unwrap().2, Some(0));
        let flattened = "(@app:fieldwork OR @app:nsurlsessiond) \
            (@host:github.com OR @host:api.github.com)";
        assert_eq!(ids(flattened), vec!["fl_daemon", "fl_node"]);
        let either = "(@app:fieldwork @host:api.github.com OR @app:slack) https";
        assert_eq!(ids(either), vec!["fl_node", "fl_slack"]);

        // Hiding System leaves out its daemons, unless the search names them.
        let hidden = |query: &str| {
            let filter = FlowFilter { hide_system: true, ..FlowFilter::search(query) };
            let mut ids: Vec<String> =
                list(&db, &filter).unwrap().into_iter().map(|f| f.id).collect();
            ids.sort();
            ids
        };
        assert_eq!(hidden(""), vec!["fl_node", "fl_none", "fl_slack"]);
        assert_eq!(hidden("@host:*.github.com"), vec!["fl_node"]);
        assert_eq!(hidden("@is:system"), vec!["fl_daemon"]);
        assert_eq!(hidden("@host:*.github.com OR @is:SYSTEM"), vec!["fl_daemon", "fl_node"]);
    }

    /// Hiding encrypted connections leaves them out of the list and its count, the totals the
    /// sidebar reads, and saved searches' counts, unless the search names them.
    #[test]
    fn hides_encrypted_connections() {
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        let flow = |id: &str, url: &str, tunnelled: bool, path: Option<&str>| Flow {
            id: id.into(),
            url: url.into(),
            method: if tunnelled { "CONNECT" } else { "GET" }.into(),
            tunnelled,
            client_path: path.map(String::from),
            ..Default::default()
        };
        for f in [
            flow("fl_get", "https://api.example.com/v1", false, None),
            flow("fl_tunnel", "https://bank.example.com", true, None),
            flow("fl_daemon_tunnel", "https://p01.icloud.com", true, Some("/usr/libexec/trustd")),
        ] {
            db.with_tx(|tx| tx.upsert(&f, &yaak_database::UpdateSource::Background)).unwrap();
        }
        let filter = |query: &str, hide_system: bool| FlowFilter {
            hide_encrypted: true,
            hide_system,
            ..FlowFilter::search(query)
        };
        let ids = |filter: FlowFilter| -> Vec<String> {
            let mut ids: Vec<String> =
                list(&db, &filter).unwrap().into_iter().map(|f| f.id).collect();
            ids.sort();
            ids
        };
        assert_eq!(ids(filter("", false)), vec!["fl_get"]);
        assert_eq!(ids(filter("example", false)), vec!["fl_get"]);
        assert_eq!(ids(filter("@is:encrypted", false)), vec!["fl_daemon_tunnel", "fl_tunnel"]);
        assert_eq!(ids(filter("@is:encrypted", true)), vec!["fl_tunnel"]);
        assert_eq!(ids(filter("@is:tunnelled", false)).len(), 2);

        // The totals: everything stored, and what shows with encrypted connections hidden.
        let page = sorted_page(&db, &FlowFilter { limit: Some(0), ..filter("", false) }).unwrap();
        assert_eq!((page.total, page.matching), (3, Some(1)));
        let page = sorted_page(&db, &FlowFilter::default()).unwrap();
        assert_eq!((page.total, page.matching), (3, None));
        assert!(FlowFilter { hide_encrypted: true, ..Default::default() }.narrows());
        assert_eq!(
            count_each(&db, &[filter("", false), filter("@is:encrypted", true)]).unwrap(),
            [1, 1]
        );

        // Saved searches count as the list would show them.
        let all = crate::saved_queries::create(&db, "All HTTPS", "@scheme:https").unwrap();
        let count = |hidden: Hidden| {
            let counts = crate::saved_queries::counts(&db, hidden).unwrap();
            counts.into_iter().find(|c| c.id == all.id).unwrap().count
        };
        assert_eq!(count(Hidden::default()), 3);
        assert_eq!(count(Hidden { system: false, encrypted: true }), 1);
        assert_eq!(count(Hidden { system: true, encrypted: false }), 2);
    }

    #[test]
    fn tells_system_daemons_apart() {
        assert!(is_system(None, Some("/usr/libexec/nsurlsessiond")));
        assert!(is_system(None, Some("/System/Library/PrivateFrameworks/X.framework/geod")));
        assert!(is_system(None, Some("/somewhere/else/trustd")));
        assert!(!is_system(None, Some("/usr/bin/curl")));
        assert!(!is_system(None, Some("/opt/homebrew/bin/node")));
        // An app in /System is an app, and WebKit's helpers send apps' traffic.
        assert!(!is_system(Some("com.apple.Music"), Some("/System/Applications/Music.app")));
        assert!(!is_system(
            None,
            Some(
                "/System/Library/Frameworks/WebKit.framework/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking"
            )
        ));
        assert!(!is_system(None, None));
        assert_eq!(folder_name(Some("/Users/me/src/fieldwork/")), Some("fieldwork"));
        assert_eq!(folder_name(Some("/")), None);
    }

    #[test]
    fn query_round_trip() {
        let filter = FlowFilter {
            query: Some("post @status:4xx".into()),
            hide_system: true,
            limit: Some(20),
            ..Default::default()
        };
        assert_eq!(filter.to_query(), "query=post+%40status%3A4xx&hide_system=true&limit=20");
        assert_eq!(FlowFilter::from_query(&filter.to_query()).unwrap(), filter);
        let filter = FlowFilter { hide_encrypted: true, ..filter };
        assert_eq!(
            filter.to_query(),
            "query=post+%40status%3A4xx&hide_system=true&hide_encrypted=true&limit=20"
        );
        assert_eq!(FlowFilter::from_query(&filter.to_query()).unwrap(), filter);
        assert!(FlowFilter::from_query("hide_encrypted=maybe").is_err());
        assert_eq!(FlowFilter::from_query("").unwrap(), FlowFilter::default());
        assert!(FlowFilter::from_query("limit=lots").is_err());
        assert!(FlowFilter::from_query("hide_system=maybe").is_err());
        assert!(filter.narrows());
        assert!(FlowFilter { hide_system: true, ..Default::default() }.narrows());
        assert!(!FlowFilter::search("  ").narrows());
    }

    #[test]
    fn previews() {
        let text = BodyPreview::new("héllo".as_bytes(), false);
        assert_eq!(
            (text.data.as_str(), text.encoding, text.size),
            ("héllo", BodyEncoding::Utf8, 6)
        );

        // Cut inside the "é".
        let cut = BodyPreview::new(&"héllo".as_bytes()[..2], true);
        assert_eq!(
            (cut.data.as_str(), cut.encoding, cut.truncated),
            ("h", BodyEncoding::Utf8, true)
        );

        let binary = BodyPreview::new(&[0xff, 0x00, 0xfe], false);
        assert_eq!(
            (binary.data.as_str(), binary.encoding, binary.size),
            ("/wD+", BodyEncoding::Base64, 3)
        );
    }

    /// Sweeping takes the flows written first, with their bodies, until the traffic is under the
    /// cap, and no more; under it, nothing goes.
    #[test]
    fn sweeping_deletes_the_oldest_until_under_the_cap() {
        use yaak_database::UpdateSource;
        use yaak_models::blob_manager::BodyChunkWriter;
        const BODY: usize = 64 * 1024;
        let dir = tempfile::tempdir().unwrap();
        let stores = Stores::open(dir.path(), &crate::db::test_key()).unwrap();
        let empty = stores.used_bytes().unwrap();
        let ids: Vec<String> = (0..20).map(|i| format!("fl_{i:02}")).collect();
        for id in &ids {
            let flow = Flow { id: id.clone(), ..Default::default() };
            stores.db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
            let body_id = Flow::body_id(id, FlowBody::Response);
            let mut writer = BodyChunkWriter::new(stores.blobs.clone(), body_id);
            writer.write(&[7; BODY]).unwrap();
            writer.finish().unwrap();
        }
        let full = stores.used_bytes().unwrap();
        assert!(full > empty + (20 * BODY) as u64, "{empty} {full}");

        assert_eq!(sweep_oldest(&stores, full).unwrap(), Vec::<String>::new(), "under the cap");

        let cap = (empty + full) / 2;
        let mut removed = Vec::new();
        loop {
            let swept = sweep_oldest(&stores, cap).unwrap();
            if swept.is_empty() {
                break;
            }
            removed.extend(swept);
        }
        assert!(stores.used_bytes().unwrap() <= cap);
        // About half went, oldest first, and no more than had to.
        assert_eq!(removed, ids[..removed.len()]);
        assert!((8..=11).contains(&removed.len()), "{removed:?}");
        let kept: Vec<String> = list(&stores.db, &FlowFilter::default())
            .unwrap()
            .into_iter()
            .rev()
            .map(|f| f.id)
            .collect();
        assert_eq!(kept, ids[removed.len()..]);
        let bodies = stores.blobs.connect();
        let has_body = |id: &str| bodies.body_exists(&Flow::body_id(id, FlowBody::Response));
        assert!(removed.iter().all(|id| !has_body(id).unwrap()));
        assert!(kept.iter().all(|id| has_body(id).unwrap()));
    }
}
