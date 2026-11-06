use crate::bodies;
use crate::db::ProxyQueryManager;
use crate::models::{Flow, FlowBody};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_database::UpsertModelInfo;
use yaak_models::blob_manager::BlobManager;

/// Which flows a listing or a HAR export covers. Every field narrows it; none is all of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FlowFilter {
    /// Search terms, any case, each of which must match the URL (host, path or query), the
    /// method, the status (`404`, `40`, `4xx`) or the content type: `stripe post 4xx`.
    #[ts(optional)]
    pub q: Option<String>,
    /// Part of the host, any case: `stripe` matches `api.stripe.com`.
    #[ts(optional)]
    pub host: Option<String>,
    /// Only flows under one of these hosts or paths, as the app's sidebar names them:
    /// `api.stripe.com` or `api.stripe.com/v1/charges`, with any port after the host. A host
    /// written `*.github.com` is a site: `github.com` and every host below it.
    #[ts(optional)]
    pub under: Option<Vec<String>>,
    /// Only flows from one of these apps: by bundle id, by path for a process outside an app
    /// bundle, by name in any case (`slack`), or, for a process outside an app, by the folder
    /// it ran in (`fieldwork`).
    #[ts(optional)]
    pub app: Option<Vec<String>>,
    /// Only flows from macOS's own daemons (true), or none of them (false), as [`is_system`]
    /// tells them by their executable.
    #[ts(optional)]
    pub system: Option<bool>,
    /// The method, any case.
    #[ts(optional)]
    pub method: Option<String>,
    /// A status (`404`), a class of them (`4xx`), or `error` for flows that failed.
    #[ts(optional)]
    pub status: Option<String>,
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
}

impl FlowFilter {
    /// The filter from a query string's `q`, `host`, `under`, `app`, `system`, `method`,
    /// `status`, `limit`, `after` and `before`. `under` and `app` may repeat.
    pub fn from_query(query: &str) -> Result<Self, String> {
        let mut filter = Self::default();
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            let value = Some(value.into_owned()).filter(|v| !v.is_empty());
            match key.as_ref() {
                "q" => filter.q = value,
                "host" => filter.host = value,
                "under" => filter.under.get_or_insert_default().extend(value),
                "app" => filter.app.get_or_insert_default().extend(value),
                "system" => {
                    filter.system = value
                        .map(|v| v.parse().map_err(|_| format!("Invalid system {v:?}")))
                        .transpose()?
                }
                "method" => filter.method = value,
                "status" => filter.status = value,
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
        let system = self.system.map(|s| s.to_string());
        for (key, value) in [("q", &self.q), ("host", &self.host), ("system", &system)] {
            if let Some(value) = value {
                query.append_pair(key, value);
            }
        }
        for (key, values) in [("under", &self.under), ("app", &self.app)] {
            for value in values.iter().flatten() {
                query.append_pair(key, value);
            }
        }
        for (key, value) in [
            ("method", &self.method),
            ("status", &self.status),
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

    /// Narrows more than `after`, `before` and `limit` do, so it covers fewer than all flows.
    pub fn narrows(&self) -> bool {
        let given = |v: &Option<String>| v.as_deref().is_some_and(|v| !v.trim().is_empty());
        given(&self.q)
            || given(&self.host)
            || given(&self.method)
            || given(&self.status)
            || self.under.is_some()
            || self.app.is_some()
            || self.system.is_some()
    }

    /// The SQL condition for every field but `after`, `before` and `limit`, and its parameters,
    /// for the database `conn` reads, which may be from before the folder column, when read
    /// without migrating.
    fn condition_in(&self, conn: &rusqlite::Connection) -> (String, Vec<Value>) {
        let has_cwd = conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM pragma_table_info('flows') WHERE name = 'client_cwd')",
                [],
                |r| r.get::<_, bool>(0),
            )
            .unwrap_or(false);
        self.condition_with(has_cwd)
    }

    fn condition_with(&self, has_cwd: bool) -> (String, Vec<Value>) {
        let mut sql = String::from("1");
        let mut params: Vec<Value> = Vec::new();
        for term in self.q.iter().flat_map(|q| q.split_whitespace()) {
            let term = term.to_lowercase();
            sql.push_str(
                " AND (instr(lower(url), ?) > 0 OR lower(method) = ? \
                OR instr(lower(content_type), ?) > 0",
            );
            params.extend([
                term.clone().into(),
                term.clone().into(),
                term.clone().into(),
            ]);
            if let Some(status) = status_condition(&term, &mut params) {
                sql.push_str(" OR ");
                sql.push_str(&status);
            }
            sql.push(')');
        }
        if let Some(host) = self.host.as_deref().filter(|h| !h.is_empty()) {
            sql.push_str(&format!(" AND instr(lower({HOST_SQL}), ?) > 0"));
            params.push(host.to_lowercase().into());
        }
        if let Some(under) = &self.under {
            // The node itself, or anything below it, by the sidebar's rules.
            let mut any = Vec::new();
            for node in under {
                if let Some(site) = site_of_node(node) {
                    any.push("under_site(url, ?)");
                    params.push(site.into());
                    continue;
                }
                let node = normalize_node(node);
                any.push("(sidebar_path(url) = ? OR substr(sidebar_path(url), 1, ?) = ?)");
                let below = format!("{node}/");
                params.extend([
                    node.into(),
                    (below.chars().count() as i64).into(),
                    below.into(),
                ]);
            }
            let any = if any.is_empty() { "0".to_string() } else { any.join(" OR ") };
            sql.push_str(&format!(" AND ({any})"));
        }
        if let Some(apps) = &self.app {
            let marks = vec!["?"; apps.len()].join(", ");
            sql.push_str(&format!(
                " AND (coalesce(client_bundle_id, client_path) IN ({marks}) \
                OR lower(client_name) IN ({marks})"
            ));
            params.extend(apps.iter().map(|a| a.clone().into()));
            params.extend(apps.iter().map(|a| a.to_lowercase().into()));
            if has_cwd {
                sql.push_str(&format!(
                    " OR (client_bundle_id IS NULL AND lower(folder_name(client_cwd)) IN ({marks}))"
                ));
                params.extend(apps.iter().map(|a| a.to_lowercase().into()));
            }
            sql.push(')');
        }
        match self.system {
            Some(true) => sql.push_str(" AND is_system(client_bundle_id, client_path)"),
            Some(false) => sql.push_str(" AND NOT is_system(client_bundle_id, client_path)"),
            None => {}
        }
        if let Some(method) = self.method.as_deref().filter(|m| !m.is_empty()) {
            sql.push_str(" AND lower(method) = ?");
            params.push(method.to_lowercase().into());
        }
        match self.status.as_deref().map(str::trim) {
            None | Some("") => {}
            Some(s) if s.eq_ignore_ascii_case("error") => sql.push_str(" AND error IS NOT NULL"),
            // A whole status or a class, not the start of one as a search term may be.
            Some(s) if s.len() == 3 => match status_condition(&s.to_ascii_lowercase(), &mut params)
            {
                Some(status) => {
                    sql.push_str(" AND ");
                    sql.push_str(&status);
                }
                None => sql.push_str(" AND 0"),
            },
            Some(_) => sql.push_str(" AND 0"),
        }
        (sql, params)
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

/// A sidebar node as `sidebar_path` writes it, its host lowercased.
fn normalize_node(node: &str) -> String {
    match node.split_once('/') {
        Some((host, path)) => format!("{}/{path}", host.to_ascii_lowercase()),
        None => node.to_ascii_lowercase(),
    }
}

/// The site a sidebar node names, `github.com` for `*.github.com`, lowercased. None for a host or
/// a path.
fn site_of_node(node: &str) -> Option<String> {
    let site = node.strip_prefix("*.")?;
    (!site.is_empty() && !site.contains('/')).then(|| site.to_ascii_lowercase())
}

/// `url`'s host, without its port, is `site` or a host below it: `api.github.com` is under
/// `github.com`.
pub fn under_site(url: &str, site: &str) -> bool {
    let path = sidebar_path(url);
    let host = path.split('/').next().unwrap_or_default();
    let host = strip_port(host);
    host == site || host.strip_suffix(site).is_some_and(|rest| rest.ends_with('.'))
}

/// `host` without a `:port` after it, keeping an IPv6 address's brackets.
fn strip_port(host: &str) -> &str {
    if host.starts_with('[') {
        return host.find(']').map_or(host, |end| &host[..=end]);
    }
    host.rsplit_once(':').map_or(host, |(h, _)| h)
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

/// The SQL condition for a status term: `404` exactly, `40` as the start of one, or a class
/// such as `4xx`. None when the term is not one.
fn status_condition(term: &str, params: &mut Vec<Value>) -> Option<String> {
    if let Some(class) = term.strip_suffix("xx")
        && let Ok(class @ 1..=9) = class.parse::<i64>()
    {
        params.push(class.into());
        return Some("status / 100 = ?".into());
    }
    if term.is_empty() || term.len() > 3 || !term.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if term.len() == 3 {
        params.push(term.parse::<i64>().ok()?.into());
        return Some("status = ?".into());
    }
    params.push(format!("{term}%").into());
    Some("CAST(status AS TEXT) LIKE ?".into())
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
    db.with_conn(|c| {
        let tx = c.conn().resolve().unchecked_transaction().map_err(|e| e.to_string())?;
        let flows = list_in(&tx, filter)?;
        let total = count_in(&tx)?;
        let matching = if filter.narrows() { Some(count_matching(&tx, filter)?) } else { None };
        tx.commit().map_err(|e| e.to_string())?;
        Ok((flows, total, matching))
    })
}

fn list_in(conn: &rusqlite::Connection, filter: &FlowFilter) -> Result<Vec<Flow>, String> {
    let (condition, mut params) = filter.condition_in(conn);
    // The rowid, for the flow's number.
    let mut sql = format!("SELECT rowid, * FROM flows WHERE {condition}");
    push_clear_mark(conn, &mut sql, &mut params);
    if let Some(id) = &filter.after {
        // By rowid, which only grows as flows are written.
        let rowid: i64 = conn
            .query_row("SELECT rowid FROM flows WHERE id = ?", [id], |r| r.get(0))
            .map_err(|_| format!("No flow {id}"))?;
        sql.push_str(" AND rowid > ?");
        params.push(rowid.into());
    }
    if let Some(id) = &filter.before {
        let started_at: Value = conn
            .query_row("SELECT started_at FROM flows WHERE id = ?", [id], |r| r.get(0))
            .map_err(|_| format!("No flow {id}"))?;
        sql.push_str(" AND (started_at, id) < (?, ?)");
        params.push(started_at);
        params.push(id.clone().into());
    }
    sql.push_str(" ORDER BY started_at DESC, id DESC");
    if let Some(limit) = filter.limit {
        sql.push_str(" LIMIT ?");
        params.push((limit.min(i64::MAX as usize) as i64).into());
    }
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params), Flow::from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn count_matching(conn: &rusqlite::Connection, filter: &FlowFilter) -> Result<usize, String> {
    let (condition, mut params) = filter.condition_in(conn);
    let mut sql = format!("SELECT COUNT(*) FROM flows WHERE {condition}");
    push_clear_mark(conn, &mut sql, &mut params);
    conn.query_row(&sql, rusqlite::params_from_iter(params), |r| r.get::<_, i64>(0))
        .map(|n| n as usize)
        .map_err(|e| e.to_string())
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

/// Flows deleted per transaction while deleting cleared ones, so a flow being written never
/// waits long behind it.
pub const DELETE_BATCH: usize = 500;

/// Deletes up to `batch` cleared flows and their bodies. Once none are left, removes the mark in
/// the same transaction, so a clear that raised it meanwhile is never lost. True when it is
/// done. The flows' deletion commits only after their bodies' has, so when deleting the bodies
/// fails the flows stay, to be deleted again.
pub fn delete_cleared(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    batch: usize,
) -> Result<bool, String> {
    db.with_tx(|c| {
        let conn = c.conn().resolve();
        let mark = clear_mark(conn);
        if mark == 0 {
            return Ok(true);
        }
        let mut stmt =
            conn.prepare("SELECT rowid, id FROM flows WHERE rowid <= ? ORDER BY rowid LIMIT ?")?;
        let rows = stmt
            .query_map([mark, batch as i64], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        if rows.is_empty() {
            conn.execute("DELETE FROM flow_clear_mark WHERE id = 1", [])?;
            return Ok(true);
        }
        blobs
            .with_tx(|b| {
                for (_, id) in &rows {
                    b.delete_chunks(&Flow::body_id(id, FlowBody::Request))?;
                    b.delete_chunks(&Flow::body_id(id, FlowBody::Response))?;
                }
                Ok::<_, yaak_models::error::Error>(())
            })
            .map_err(|e| yaak_database::Error::Database(format!("flow bodies: {e}")))?;
        let mut delete = conn.prepare("DELETE FROM flows WHERE rowid = ?")?;
        for (rowid, _) in &rows {
            delete.execute([rowid])?;
        }
        // The last of them: the mark goes in the same transaction, since an empty table hands
        // out rowids from 1 again and a new flow would fall under it.
        let left: bool =
            conn.query_row("SELECT EXISTS (SELECT 1 FROM flows WHERE rowid <= ?)", [mark], |r| {
                r.get(0)
            })?;
        if !left {
            conn.execute("DELETE FROM flow_clear_mark WHERE id = 1", [])?;
            return Ok(true);
        }
        Ok::<_, yaak_database::Error>(false)
    })
    .map_err(|e| format!("Failed to delete cleared flows: {e}"))
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
    let request_body = preview(blobs, &flow, FlowBody::Request, body_cap).await?;
    let response_body = preview(blobs, &flow, FlowBody::Response, body_cap).await?;
    Ok(FlowDetail { flow, request_body, response_body })
}

async fn preview(
    blobs: &BlobManager,
    flow: &Flow,
    which: FlowBody,
    cap: usize,
) -> Result<Option<BodyPreview>, String> {
    let body = bodies::read_body(blobs, flow, which, cap).await?;
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
        let db = ProxyQueryManager::new(&dir.path().join("proxy.db")).unwrap();
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

    #[test]
    fn filters() {
        let (_dir, db) = db_of(vec![
            flow("https://api.stripe.com:8443/v1/charges?x=1", "POST", Some(200), None),
            flow("http://example.com/missing", "GET", Some(404), None),
            flow("https://down.example.com/", "GET", None, Some("refused")),
        ]);
        let by = |filter: FlowFilter| urls(&db, filter).len();
        assert_eq!(by(FlowFilter::default()), 3);
        assert_eq!(by(FlowFilter { host: Some("STRIPE".into()), ..Default::default() }), 1);
        assert_eq!(by(FlowFilter { host: Some("example.com".into()), ..Default::default() }), 2);
        assert_eq!(by(FlowFilter { host: Some("charges".into()), ..Default::default() }), 0);
        assert_eq!(by(FlowFilter { host: Some("8443".into()), ..Default::default() }), 1);
        assert_eq!(by(FlowFilter { method: Some("get".into()), ..Default::default() }), 2);
        assert_eq!(by(FlowFilter { status: Some("404".into()), ..Default::default() }), 1);
        assert_eq!(by(FlowFilter { status: Some("2xx".into()), ..Default::default() }), 1);
        assert_eq!(by(FlowFilter { status: Some("5XX".into()), ..Default::default() }), 0);
        assert_eq!(by(FlowFilter { status: Some("40".into()), ..Default::default() }), 0);
        assert_eq!(by(FlowFilter { status: Some("error".into()), ..Default::default() }), 1);
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
        let search = |q: &str| {
            let filter = FlowFilter { q: Some(q.into()), ..Default::default() };
            let mut found = urls(&db, filter);
            found.sort();
            found
        };
        let stripe = "https://api.stripe.com/v1/charges?customer=cus_9";
        let github = "https://api.github.com/repos/yaak";
        let logo = "https://images.ctfassets.net/logo.png";
        let health = "http://localhost:3000/health";
        // The host, the path and the query, any case.
        assert_eq!(search("STRIPE"), vec![stripe]);
        assert_eq!(search("/repos/"), vec![github]);
        assert_eq!(search("cus_9"), vec![stripe]);
        // The method, whole.
        assert_eq!(search("head"), vec![health]);
        assert_eq!(search("ead"), Vec::<&str>::new());
        // A status, its start, or its class.
        assert_eq!(search("404"), vec![github]);
        assert_eq!(search("50"), vec![health]);
        assert_eq!(search("2xx"), vec![stripe, logo]);
        // The content type.
        assert_eq!(search("png"), vec![logo]);
        assert_eq!(search("json"), vec![github, stripe]);
        // Every term must match, each anywhere.
        assert_eq!(search("json get"), vec![github]);
        assert_eq!(search("  json   2xx "), vec![stripe]);
        assert_eq!(search("json 5xx"), Vec::<&str>::new());
        // `%` and `_` are plain characters, not patterns.
        assert_eq!(search("%"), Vec::<&str>::new());
        assert_eq!(search("cus_"), vec![stripe]);
        assert_eq!(search(""), vec![health, github, stripe, logo]);
    }

    #[test]
    fn under_matches_a_host_or_a_path_as_the_sidebar_does() {
        let (_dir, db) = db_of(vec![
            flow("https://api.stripe.com/v1/charges", "GET", Some(200), None),
            flow("https://api.stripe.com/v1/charges/ch_1?expand=x", "GET", Some(200), None),
            flow("https://api.stripe.com/v1/chargesx", "GET", Some(200), None),
            flow("https://api.stripe.com:8443/v1/charges", "GET", Some(200), None),
            flow("http://api.stripe.com", "GET", Some(200), None),
            flow("https://api.stripe.community/", "GET", Some(200), None),
            flow("https://example.com/v1//users", "GET", Some(200), None),
            flow("http://x.com:80/a", "GET", Some(200), None),
            flow("https://x.com:443/a", "GET", Some(200), None),
        ]);
        let under = |nodes: &[&str]| {
            let nodes = nodes.iter().map(|n| n.to_string()).collect();
            urls(&db, FlowFilter { under: Some(nodes), ..Default::default() }).len()
        };
        // A host on another port is a node of its own, as in the sidebar.
        assert_eq!(under(&["api.stripe.com"]), 4);
        assert_eq!(under(&["api.stripe.com:8443"]), 1);
        assert_eq!(under(&["api.stripe.com/v1/charges"]), 2);
        // Empty segments and default ports are left out, as the sidebar leaves them.
        assert_eq!(under(&["example.com/v1/users"]), 1);
        assert_eq!(under(&["x.com/a"]), 2);
        assert_eq!(under(&["api.stripe.com/v1/charges", "example.com"]), 3);
        assert_eq!(under(&[]), 0);
        // The sidebar lowercases hosts; paths keep their case.
        assert_eq!(under(&["API.stripe.com/v1/charges"]), 2);
        assert_eq!(under(&["api.stripe.com/V1/charges"]), 0);
    }

    /// The cases `lib/search.test.ts` checks `sidebarPath` against, so the two agree.
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
        let app = |apps: &[&str]| {
            let apps = apps.iter().map(|a| a.to_string()).collect();
            urls(&db, FlowFilter { app: Some(apps), ..Default::default() }).len()
        };
        assert_eq!(app(&["com.google.Chrome"]), 2);
        assert_eq!(app(&["/usr/bin/curl"]), 1);
        assert_eq!(app(&["/Applications/Google Chrome.app"]), 0);
        assert_eq!(app(&["com.google.Chrome", "/usr/bin/curl"]), 3);
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
            q: Some("post".into()),
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

    #[test]
    fn a_search_reads_the_newest_page_through_the_index() {
        let (_dir, db) = db_of(vec![]);
        let plan: Vec<String> = db.with_conn(|c| {
            let conn = c.conn().resolve();
            let (condition, params) =
                FlowFilter { q: Some("stripe".into()), ..Default::default() }.condition_in(conn);
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
        let db = ProxyQueryManager::new(&dir.path().join("proxy.db")).unwrap();
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
        let db = ProxyQueryManager::new(&dir.path().join("proxy.db")).unwrap();
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
            status: Some("2xx".into()),
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
        let db = ProxyQueryManager::new(&dir.path().join("proxy.db")).unwrap();
        let blobs = yaak_models::init_blob_store(dir.path().join("blobs.sqlite")).unwrap();
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
        let narrowed = FlowFilter { q: Some("example".into()), ..Default::default() };
        assert_eq!(page(&db, &narrowed).unwrap().1, 1);

        // Bodies that fail to delete keep their flows, to delete again.
        let read_only = crate::db::open_blobs_read_only(&dir.path().join("blobs.sqlite")).unwrap();
        assert!(delete_cleared(&db, &read_only, 2).is_err());
        assert_eq!(rows(), 4);

        // In batches, the mark going with the last of them.
        assert_eq!(delete_cleared(&db, &blobs, 2), Ok(false));
        assert_eq!(rows(), 2);
        assert_eq!(delete_cleared(&db, &blobs, 2), Ok(true));
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
        assert_eq!(delete_cleared(&db, &blobs, DELETE_BATCH), Ok(true));
        assert_eq!(rows(), 0);

        // An empty table numbers from 1 again, which no stale mark may hide.
        write_flow("fl_e");
        assert_eq!(ids(&FlowFilter::default()), vec!["fl_e"]);
        assert_eq!(delete_cleared(&db, &blobs, DELETE_BATCH), Ok(true));
        assert_eq!(rows(), 1);
    }

    #[test]
    fn numbers_flows_by_rowid_and_keeps_it_on_update() {
        use yaak_database::UpdateSource;
        let dir = tempfile::tempdir().unwrap();
        let db = ProxyQueryManager::new(&dir.path().join("proxy.db")).unwrap();
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
        let db = ProxyQueryManager::new(&dir.path().join("proxy.db")).unwrap();
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
        let app = |a: &str| FlowFilter { app: Some(vec![a.into()]), ..Default::default() };
        assert_eq!(ids(app("slack")), vec!["fl_slack"]);
        assert_eq!(ids(app("com.tinyspeck.slackmacgap")), vec!["fl_slack"]);
        assert_eq!(ids(app("Fieldwork")), vec!["fl_node"]);
        assert_eq!(ids(app("/opt/homebrew/bin/node")), vec!["fl_node"]);
        let under = |n: &str| FlowFilter { under: Some(vec![n.into()]), ..Default::default() };
        assert_eq!(ids(under("*.github.com")), vec!["fl_daemon", "fl_node"]);
        assert_eq!(ids(under("api.github.com")), vec!["fl_node"]);
        let system = |s| FlowFilter { system: Some(s), ..Default::default() };
        assert_eq!(ids(system(true)), vec!["fl_daemon"]);
        assert_eq!(ids(system(false)), vec!["fl_node", "fl_none", "fl_slack"]);
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
        assert!(under_site("https://api.github.com:8443/x", "github.com"));
        assert!(!under_site("https://notgithub.com/", "github.com"));
    }

    #[test]
    fn query_round_trip() {
        let filter = FlowFilter {
            q: Some("post json".into()),
            host: Some("api.stripe.com".into()),
            under: Some(vec!["api.stripe.com/v1".into(), "example.com".into()]),
            app: Some(vec!["com.google.Chrome".into()]),
            status: Some("4xx".into()),
            limit: Some(20),
            ..Default::default()
        };
        assert_eq!(
            filter.to_query(),
            "q=post+json&host=api.stripe.com&under=api.stripe.com%2Fv1&under=example.com\
            &app=com.google.Chrome&status=4xx&limit=20"
        );
        assert_eq!(FlowFilter::from_query(&filter.to_query()).unwrap(), filter);
        assert_eq!(FlowFilter::from_query("").unwrap(), FlowFilter::default());
        assert!(FlowFilter::from_query("limit=lots").is_err());
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
}
