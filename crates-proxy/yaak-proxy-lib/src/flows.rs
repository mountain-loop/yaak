use crate::bodies;
use crate::db::ProxyQueryManager;
use crate::models::{Flow, FlowBody, FlowIden};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_database::UpsertModelInfo;
use yaak_models::blob_manager::BlobManager;

/// Which flows a listing or a HAR export covers. Every field narrows it; none is all of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FlowFilter {
    /// Part of the host, any case: `stripe` matches `api.stripe.com`.
    #[ts(optional)]
    pub host: Option<String>,
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
    /// The filter from a query string's `host`, `method`, `status`, `limit`, `after` and
    /// `before`.
    pub fn from_query(query: &str) -> Result<Self, String> {
        let mut filter = Self::default();
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            let value = Some(value.into_owned()).filter(|v| !v.is_empty());
            match key.as_ref() {
                "host" => filter.host = value,
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
        for (key, value) in [
            ("host", &self.host),
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

    pub fn matches(&self, flow: &Flow) -> bool {
        if let Some(host) = &self.host
            && !host_of(&flow.url).to_ascii_lowercase().contains(&host.to_ascii_lowercase())
        {
            return false;
        }
        if let Some(method) = &self.method
            && !flow.method.eq_ignore_ascii_case(method)
        {
            return false;
        }
        match self.status.as_deref().map(str::trim) {
            None | Some("") => true,
            Some(s) if s.eq_ignore_ascii_case("error") => flow.error.is_some(),
            Some(s) => match (flow.status, s.to_ascii_lowercase().strip_suffix("xx")) {
                (Some(status), Some(class)) => class.parse() == Ok(status / 100),
                (Some(status), None) => s.parse() == Ok(status),
                (None, _) => false,
            },
        }
    }
}

/// `host[:port]` of a captured URL.
fn host_of(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split(['/', '?', '#']).next().unwrap_or_default()
}

/// The flows `filter` covers, newest first: by start, then by id. Reads only as far into the
/// table as the limit needs, so a page costs the same however many flows there are.
pub fn list(db: &ProxyQueryManager, filter: &FlowFilter) -> Result<Vec<Flow>, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let mut sql = String::from("SELECT * FROM flows WHERE 1");
        let mut params: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(id) = &filter.after {
            // By rowid, which only grows as flows are written.
            let rowid: i64 = conn
                .query_row("SELECT rowid FROM flows WHERE id = ?", [id], |r| r.get(0))
                .map_err(|_| format!("No flow {id}"))?;
            sql.push_str(" AND rowid > ?");
            params.push(rowid.into());
        }
        if let Some(id) = &filter.before {
            let started_at: rusqlite::types::Value = conn
                .query_row("SELECT started_at FROM flows WHERE id = ?", [id], |r| r.get(0))
                .map_err(|_| format!("No flow {id}"))?;
            sql.push_str(" AND (started_at, id) < (?, ?)");
            params.push(started_at);
            params.push(id.clone().into());
        }
        sql.push_str(" ORDER BY started_at DESC, id DESC");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params), Flow::from_row)
            .map_err(|e| e.to_string())?;
        let mut flows = Vec::new();
        for flow in rows {
            if flows.len() >= filter.limit.unwrap_or(usize::MAX) {
                break;
            }
            let flow = flow.map_err(|e| e.to_string())?;
            if filter.matches(&flow) {
                flows.push(flow);
            }
        }
        Ok(flows)
    })
}

/// Deletes every flow, then their bodies, each in a transaction. Returns how many there were.
pub fn clear(db: &ProxyQueryManager, blobs: &BlobManager) -> Result<usize, String> {
    let ids = db
        .with_tx(|c| {
            let conn = c.conn().resolve();
            let mut stmt = conn.prepare("SELECT id FROM flows")?;
            let ids = stmt.query_map([], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
            conn.execute("DELETE FROM flows", [])?;
            Ok::<_, yaak_database::Error>(ids)
        })
        .map_err(|e| format!("Failed to clear flows: {e}"))?;
    // Only the deleted flows' bodies, so a flow still in flight keeps what it has written.
    blobs
        .with_tx(|b| {
            for id in &ids {
                b.delete_chunks(&Flow::body_id(id, FlowBody::Request))?;
                b.delete_chunks(&Flow::body_id(id, FlowBody::Response))?;
            }
            Ok::<_, yaak_models::error::Error>(())
        })
        .map_err(|e| format!("Failed to clear flow bodies: {e}"))?;
    Ok(ids.len())
}

pub fn find(db: &ProxyQueryManager, flow_id: &str) -> Option<Flow> {
    db.with_conn(|c| c.find_optional::<Flow>(FlowIden::Id, flow_id))
}

pub fn get(db: &ProxyQueryManager, flow_id: &str) -> Result<Flow, String> {
    find(db, flow_id).ok_or_else(|| format!("No flow {flow_id}"))
}

pub fn count(db: &ProxyQueryManager) -> Result<usize, String> {
    db.with_conn(|c| {
        c.conn()
            .resolve()
            .query_row("SELECT COUNT(*) FROM flows", [], |r| r.get::<_, i64>(0))
            .map(|n| n as usize)
            .map_err(|e| e.to_string())
    })
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

    #[test]
    fn filters() {
        let ok = flow("https://api.stripe.com:8443/v1/charges?x=1", "POST", Some(200), None);
        let missing = flow("http://example.com/missing", "GET", Some(404), None);
        let failed = flow("https://down.example.com/", "GET", None, Some("refused"));

        let by = |filter: FlowFilter| {
            [&ok, &missing, &failed].iter().filter(|f| filter.matches(f)).count()
        };
        assert_eq!(by(FlowFilter::default()), 3);
        assert_eq!(by(FlowFilter { host: Some("STRIPE".into()), ..Default::default() }), 1);
        assert_eq!(by(FlowFilter { host: Some("example.com".into()), ..Default::default() }), 2);
        assert_eq!(by(FlowFilter { host: Some("charges".into()), ..Default::default() }), 0);
        assert_eq!(by(FlowFilter { method: Some("get".into()), ..Default::default() }), 2);
        assert_eq!(by(FlowFilter { status: Some("404".into()), ..Default::default() }), 1);
        assert_eq!(by(FlowFilter { status: Some("2xx".into()), ..Default::default() }), 1);
        assert_eq!(by(FlowFilter { status: Some("5XX".into()), ..Default::default() }), 0);
        assert_eq!(by(FlowFilter { status: Some("error".into()), ..Default::default() }), 1);
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
        for (id, started) in [("fl_a", 10), ("fl_b", 20), ("fl_c", 20), ("fl_d", 30), ("fl_e", 40)]
        {
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
        let older = FlowFilter { before: Some("fl_d".into()), limit: Some(2), ..Default::default() };
        assert_eq!(page(older), vec!["fl_c", "fl_b"]);
        let oldest = FlowFilter { before: Some("fl_b".into()), limit: Some(2), ..Default::default() };
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

        assert_eq!(clear(&db, &blobs).unwrap(), 2);
        assert_eq!(count(&db).unwrap(), 0);
        let body_ids = blobs.connect().list_body_ids().unwrap();
        assert_eq!(body_ids, vec![Flow::body_id("fl_live", FlowBody::Request)]);
        assert_eq!(clear(&db, &blobs).unwrap(), 0);
    }

    #[test]
    fn query_round_trip() {
        let filter = FlowFilter {
            host: Some("api.stripe.com".into()),
            status: Some("4xx".into()),
            limit: Some(20),
            ..Default::default()
        };
        assert_eq!(filter.to_query(), "host=api.stripe.com&status=4xx&limit=20");
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
