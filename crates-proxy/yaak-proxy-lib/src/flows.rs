use crate::bodies;
use crate::db::ProxyQueryManager;
use crate::models::{Flow, FlowBody, FlowIden};
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
    /// `api.stripe.com` or `api.stripe.com/v1/charges`, with any port after the host.
    #[ts(optional)]
    pub under: Option<Vec<String>>,
    /// Only flows from one of these apps, by bundle id, or by path for a process outside an
    /// app bundle.
    #[ts(optional)]
    pub app: Option<Vec<String>>,
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
    /// The filter from a query string's `q`, `host`, `under`, `app`, `method`, `status`,
    /// `limit`, `after` and `before`. `under` and `app` may repeat.
    pub fn from_query(query: &str) -> Result<Self, String> {
        let mut filter = Self::default();
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            let value = Some(value.into_owned()).filter(|v| !v.is_empty());
            match key.as_ref() {
                "q" => filter.q = value,
                "host" => filter.host = value,
                "under" => filter.under.get_or_insert_default().extend(value),
                "app" => filter.app.get_or_insert_default().extend(value),
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
        for (key, value) in [("q", &self.q), ("host", &self.host)] {
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
    }

    /// The SQL condition for every field but `after`, `before` and `limit`, and its parameters.
    fn condition(&self) -> (String, Vec<Value>) {
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
            // Each is `scheme://` and then the node, ending the URL or followed by what can
            // follow a host or a path segment.
            let mut any = Vec::new();
            for node in under {
                for scheme in ["http://", "https://"] {
                    let prefix = format!("{scheme}{node}");
                    any.push(
                        "(substr(url, 1, ?) = ? AND substr(url, ? + 1, 1) IN ('', '/', '?', '#'))",
                    );
                    let len = prefix.chars().count() as i64;
                    params.extend([len.into(), prefix.into(), len.into()]);
                    if !node.contains('/') && !node.contains(':') {
                        // A host's flows on another port sit under it too.
                        any.push("(substr(url, 1, ?) = ?)");
                        let prefix = format!("{scheme}{node}:");
                        params.extend([(prefix.chars().count() as i64).into(), prefix.into()]);
                    }
                }
            }
            sql.push_str(&format!(
                " AND ({})",
                if any.is_empty() { "0".into() } else { any.join(" OR ") }
            ));
        }
        if let Some(apps) = &self.app {
            let marks = vec!["?"; apps.len()].join(", ");
            sql.push_str(&format!(" AND coalesce(client_bundle_id, client_path) IN ({marks})"));
            params.extend(apps.iter().map(|a| a.clone().into()));
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
    let (condition, mut params) = filter.condition();
    let mut sql = format!("SELECT * FROM flows WHERE {condition}");
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
    let (condition, params) = filter.condition();
    conn.query_row(
        &format!("SELECT COUNT(*) FROM flows WHERE {condition}"),
        rusqlite::params_from_iter(params),
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n as usize)
    .map_err(|e| e.to_string())
}

/// Deletes every flow and their bodies, in a transaction in each database. The flows' deletion
/// commits only after their bodies' has, so when clearing the bodies fails the flows stay, to be
/// cleared again. Returns how many there were.
pub fn clear(db: &ProxyQueryManager, blobs: &BlobManager) -> Result<usize, String> {
    db.with_tx(|c| {
        let conn = c.conn().resolve();
        let mut stmt = conn.prepare("SELECT id FROM flows")?;
        let ids = stmt.query_map([], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
        conn.execute("DELETE FROM flows", [])?;
        // Only the deleted flows' bodies, so a flow still in flight keeps what it has written.
        blobs
            .with_tx(|b| {
                for id in &ids {
                    b.delete_chunks(&Flow::body_id(id, FlowBody::Request))?;
                    b.delete_chunks(&Flow::body_id(id, FlowBody::Response))?;
                }
                Ok::<_, yaak_models::error::Error>(())
            })
            .map_err(|e| yaak_database::Error::Database(format!("flow bodies: {e}")))?;
        Ok::<_, yaak_database::Error>(ids.len())
    })
    .map_err(|e| format!("Failed to clear flows: {e}"))
}

pub fn find(db: &ProxyQueryManager, flow_id: &str) -> Option<Flow> {
    db.with_conn(|c| c.find_optional::<Flow>(FlowIden::Id, flow_id))
}

pub fn get(db: &ProxyQueryManager, flow_id: &str) -> Result<Flow, String> {
    find(db, flow_id).ok_or_else(|| format!("No flow {flow_id}"))
}

pub fn count(db: &ProxyQueryManager) -> Result<usize, String> {
    db.with_conn(|c| count_in(c.conn().resolve()))
}

fn count_in(conn: &rusqlite::Connection) -> Result<usize, String> {
    conn.query_row("SELECT COUNT(*) FROM flows", [], |r| r.get::<_, i64>(0))
        .map(|n| n as usize)
        .map_err(|e| e.to_string())
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
            flow("https://example.com/", "GET", Some(200), None),
        ]);
        let under = |nodes: &[&str]| {
            let nodes = nodes.iter().map(|n| n.to_string()).collect();
            urls(&db, FlowFilter { under: Some(nodes), ..Default::default() }).len()
        };
        assert_eq!(under(&["api.stripe.com"]), 5);
        assert_eq!(under(&["api.stripe.com:8443"]), 1);
        assert_eq!(under(&["api.stripe.com/v1/charges"]), 2);
        assert_eq!(under(&["api.stripe.com/v1/charges", "example.com"]), 3);
        assert_eq!(under(&[]), 0);
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
                FlowFilter { q: Some("stripe".into()), ..Default::default() }.condition();
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
    fn clear_deletes_flows_and_their_bodies() {
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
        for id in ["fl_a", "fl_b"] {
            write_body(id, FlowBody::Request);
            write_body(id, FlowBody::Response);
            let flow = Flow { id: id.into(), ..Default::default() };
            db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        }
        // A flow still in flight has written a body but not its row.
        write_body("fl_live", FlowBody::Request);

        // Bodies that fail to clear keep their flows, to clear again.
        let read_only = crate::db::open_blobs_read_only(&dir.path().join("blobs.sqlite")).unwrap();
        assert!(clear(&db, &read_only).is_err());
        assert_eq!(count(&db).unwrap(), 2);

        assert_eq!(clear(&db, &blobs).unwrap(), 2);
        assert_eq!(count(&db).unwrap(), 0);
        let body_ids = blobs.connect().list_body_ids().unwrap();
        assert_eq!(body_ids, vec![Flow::body_id("fl_live", FlowBody::Request)]);
        assert_eq!(clear(&db, &blobs).unwrap(), 0);
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
