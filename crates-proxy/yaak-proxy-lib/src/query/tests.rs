//! The compiler's tests. Each term kind against flows made for it, then the drift guard: for a
//! sample of varied flows and a battery of queries, the database's answer and the evaluator's
//! must be the same flows.

use super::*;
use crate::db::ProxyQueryManager;
use crate::models::StreamKind;
use chrono::Duration;
use yaak_database::UpdateSource;

/// When the tests run: every flow's start and every `@time` counts from here.
fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-11-07T12:00:00Z").unwrap().with_timezone(&Utc)
}

fn header(name: &str, value: &str) -> ProxyHeader {
    ProxyHeader { name: name.into(), value: value.into() }
}

/// A database holding `flows`, numbered in order, with what they read back as.
fn db_of(flows: Vec<Flow>) -> (tempfile::TempDir, ProxyQueryManager, Vec<Flow>) {
    let dir = tempfile::tempdir().unwrap();
    let db = ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
    let mut stored = Vec::new();
    for flow in flows {
        let read = flow.agent_read;
        let (mut saved, _) = db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        if read {
            db.with_tx(|tx| {
                tx.conn()
                    .resolve()
                    .execute("UPDATE flows SET agent_read = TRUE WHERE id = ?", [&saved.id])
                    .map_err(yaak_database::Error::from)
            })
            .unwrap();
            saved.agent_read = true;
        }
        stored.push(saved);
    }
    (dir, db, stored)
}

/// The ids the database finds for `query`, sorted.
fn sql_ids(db: &ProxyQueryManager, query: &FlowQuery) -> Vec<String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let (condition, params) = query.sql(&FlowColumns::of(conn));
        let sql = format!("SELECT id FROM flows WHERE {condition} ORDER BY id");
        let mut stmt = conn.prepare(&sql).unwrap_or_else(|e| panic!("{e}: {sql}"));
        stmt.query_map(rusqlite::params_from_iter(params), |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<String>>>()
            .unwrap()
    })
}

/// The ids the evaluator finds for `query`, sorted.
fn memory_ids(flows: &[Flow], query: &FlowQuery) -> Vec<String> {
    let matcher = query.matcher();
    let mut ids: Vec<String> =
        flows.iter().filter(|f| matcher.matches(&document(f))).map(|f| f.id.clone()).collect();
    ids.sort();
    ids
}

/// Flows made for the tests below, each named by what sets it apart.
fn fixture() -> Vec<Flow> {
    let at = |minutes_ago: i64| (now() - Duration::minutes(minutes_ago)).naive_utc();
    let base = |id: &str, url: &str| Flow {
        id: id.into(),
        url: url.into(),
        method: "GET".into(),
        client_http_version: "HTTP/1.1".into(),
        started_at: at(1),
        ..Default::default()
    };
    vec![
        Flow {
            status: Some(200),
            content_type: Some("application/json; charset=utf-8".into()),
            request_headers: vec![header("Accept", "application/json")],
            response_headers: vec![
                header("X-Cache", "HIT"),
                header("Content-Type", "application/json"),
            ],
            response_size: 250_000,
            request_size: 120,
            elapsed_ms: Some(820),
            client_http_version: "HTTP/2".into(),
            client_name: Some("Google Chrome".into()),
            client_bundle_id: Some("com.google.Chrome".into()),
            client_path: Some("/Applications/Google Chrome.app".into()),
            client_pid: Some(501),
            saved_request_id: Some("rq_1".into()),
            started_at: at(2),
            ..base("fl_github", "https://api.github.com/repos/yaak?page=2&sort=Stars")
        },
        Flow {
            method: "POST".into(),
            status: Some(404),
            content_type: Some("text/html".into()),
            request_headers: vec![header("Content-Type", "application/x-www-form-urlencoded")],
            response_headers: vec![header("x-cache", "MISS")],
            response_size: 900,
            elapsed_ms: Some(40),
            client_name: Some("curl".into()),
            client_path: Some("/usr/bin/curl".into()),
            client_cwd: Some("/Users/ada/src/fieldwork".into()),
            started_at: at(30),
            ..base("fl_stripe", "http://api.stripe.com:8080/v1/charges/ch_1")
        },
        Flow {
            status: Some(503),
            error: None,
            request_headers: vec![header("content-type", "application/json")],
            response_size: 2_000_000,
            elapsed_ms: Some(3_000),
            client_name: Some("nsurlsessiond".into()),
            client_path: Some("/usr/libexec/nsurlsessiond".into()),
            client_cwd: Some("/".into()),
            started_at: at(90),
            ..base("fl_daemon", "https://github.com/login")
        },
        Flow {
            method: "CONNECT".into(),
            tunnelled: true,
            response_size: 5_000,
            elapsed_ms: Some(10_000),
            started_at: at(60 * 25),
            ..base("fl_tunnel", "https://bank.example.com")
        },
        Flow {
            error: Some("connection refused".into()),
            started_at: at(3),
            ..base("fl_error", "http://localhost:3000/health")
        },
        Flow {
            started_at: at(0),
            agent_read: true,
            ..base("fl_pending", "https://example.com/slow")
        },
        Flow {
            status: Some(101),
            stream_kind: Some(StreamKind::Websocket),
            elapsed_ms: Some(50),
            ..base("fl_ws", "wss://ws.example.com/socket")
        },
        Flow {
            method: "POST".into(),
            status: Some(200),
            stream_kind: Some(StreamKind::Grpc),
            grpc_status: Some(5),
            client_http_version: "HTTP/2".into(),
            elapsed_ms: Some(12),
            ..base("fl_grpc", "https://grpc.example.com/pkg.Service/Method")
        },
        Flow { status: Some(508), elapsed_ms: Some(1), ..base("fl_loop", "http://neverssl.com/") },
    ]
}

/// The fixture's ids `query` finds, after checking the database and the evaluator agree.
fn finds(query: &str) -> Vec<String> {
    finds_with(query, false)
}

fn finds_with(query: &str, hide_system: bool) -> Vec<String> {
    let (_dir, db, flows) = db_of(fixture());
    let prepared = FlowQuery::at(query, hide_system, now());
    let sql = sql_ids(&db, &prepared);
    assert_eq!(sql, memory_ids(&flows, &prepared), "the two disagree on {query:?}");
    sql
}

fn ids(ids: &[&str]) -> Vec<String> {
    let mut ids: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
    ids.sort();
    ids
}

#[test]
fn bare_words_search_url_method_status_and_type() {
    assert_eq!(finds("GITHUB"), ids(&["fl_daemon", "fl_github"]));
    assert_eq!(finds("post"), ids(&["fl_grpc", "fl_stripe"]));
    assert_eq!(finds("404"), ids(&["fl_stripe"]));
    assert_eq!(finds("html"), ids(&["fl_stripe"]));
    assert_eq!(finds("\"api.github.com/repos\""), ids(&["fl_github"]));
    assert_eq!(finds("github repos"), ids(&["fl_github"]));
    // Headers are not free text
    assert_eq!(finds("HIT"), ids(&[]));
}

#[test]
fn url_fields() {
    assert_eq!(finds("@host:api.github.com"), ids(&["fl_github"]));
    assert_eq!(finds("@host:github"), ids(&[]));
    assert_eq!(finds("@host:*github*"), ids(&["fl_daemon", "fl_github"]));
    // A site is its domain and every host below it
    assert_eq!(finds("@host:*.github.com"), ids(&["fl_daemon", "fl_github"]));
    assert_eq!(finds("@host:*.example.com"), ids(&["fl_grpc", "fl_pending", "fl_tunnel", "fl_ws"]));
    // A host on another port, with or without it
    assert_eq!(finds("@host:api.stripe.com"), ids(&["fl_stripe"]));
    assert_eq!(finds("@host:api.stripe.com:8080"), ids(&["fl_stripe"]));
    assert_eq!(finds("@port:8080"), ids(&["fl_stripe"]));
    assert_eq!(finds("@port:443 @scheme:wss"), ids(&["fl_ws"]));
    assert_eq!(finds("@port:<1000 @scheme:http"), ids(&["fl_loop"]));
    assert_eq!(finds("@scheme:http"), ids(&["fl_error", "fl_loop", "fl_stripe"]));
    assert_eq!(finds("@path:/v1"), ids(&["fl_stripe"]));
    assert_eq!(finds("@path:/v1/*"), ids(&["fl_stripe"]));
    assert_eq!(finds("@path:/v1/charges/*"), ids(&["fl_stripe"]));
    assert_eq!(finds("@path:/v1/charges/ch_1/*"), ids(&["fl_stripe"]));
    assert_eq!(finds("@path:/v1/charge/*"), ids(&[]));
    assert_eq!(
        finds("@path:/"),
        ids(&[
            "fl_daemon",
            "fl_error",
            "fl_github",
            "fl_grpc",
            "fl_loop",
            "fl_pending",
            "fl_stripe",
            "fl_ws"
        ])
    );
    assert_eq!(finds("@url:*page=2*"), ids(&["fl_github"]));
    assert_eq!(finds("@query.page:2"), ids(&["fl_github"]));
    assert_eq!(finds("@query.SORT:stars"), ids(&["fl_github"]));
    assert_eq!(finds("@query.page:*"), ids(&["fl_github"]));
    assert_eq!(finds("@query.page:>1"), ids(&["fl_github"]));
    assert_eq!(finds("@query:stars"), ids(&["fl_github"]));
    assert_eq!(
        finds("-@query.page:*"),
        ids(&[
            "fl_daemon",
            "fl_error",
            "fl_grpc",
            "fl_loop",
            "fl_pending",
            "fl_stripe",
            "fl_tunnel",
            "fl_ws"
        ])
    );
}

#[test]
fn request_and_response_fields() {
    assert_eq!(finds("@method:post"), ids(&["fl_grpc", "fl_stripe"]));
    assert_eq!(finds("@method:CONN*"), ids(&["fl_tunnel"]));
    assert_eq!(finds("@type:json"), ids(&["fl_daemon", "fl_github"]));
    // The request's only when the response has none
    assert_eq!(finds("@type:form"), ids(&[]));
    assert_eq!(finds("@proto:h2"), ids(&["fl_github", "fl_grpc"]));
    assert_eq!(finds("@proto:ws"), ids(&["fl_ws"]));
    assert_eq!(finds("@proto:grpc"), ids(&["fl_grpc"]));
    assert_eq!(finds("@proto:h1 @method:post"), ids(&["fl_stripe"]));
    assert_eq!(finds("@id:2"), ids(&["fl_stripe"]));
    assert_eq!(finds("@id:>=8"), ids(&["fl_grpc", "fl_loop"]));
}

#[test]
fn statuses() {
    assert_eq!(finds("@status:404"), ids(&["fl_stripe"]));
    assert_eq!(finds("@status:4xx"), ids(&["fl_stripe"]));
    assert_eq!(finds("@status:5XX"), ids(&["fl_daemon", "fl_loop"]));
    assert_eq!(finds("@status:>=400"), ids(&["fl_daemon", "fl_loop", "fl_stripe"]));
    assert_eq!(finds("@status:[200 TO 299]"), ids(&["fl_github", "fl_grpc"]));
    assert_eq!(finds("@status:50*"), ids(&["fl_daemon", "fl_loop"]));
    assert_eq!(
        finds("@status:*"),
        ids(&[
            "fl_daemon",
            "fl_github",
            "fl_grpc",
            "fl_loop",
            "fl_stripe",
            "fl_ws"
        ])
    );
    assert_eq!(finds("-@status:*"), ids(&["fl_error", "fl_pending", "fl_tunnel"]));
    assert_eq!(finds("@status:40"), ids(&[]));
}

#[test]
fn sizes_and_durations_with_units() {
    assert_eq!(finds("@size:>100kb"), ids(&["fl_daemon", "fl_github"]));
    assert_eq!(finds("@size:>1mb"), ids(&["fl_daemon"]));
    assert_eq!(finds("@res.size:[1kb TO 10kb]"), ids(&["fl_tunnel"]));
    assert_eq!(finds("@req.size:120b"), ids(&["fl_github"]));
    assert_eq!(finds("@size:>1.5gb"), ids(&[]));
    assert_eq!(finds("@duration:>500ms"), ids(&["fl_daemon", "fl_github", "fl_tunnel"]));
    assert_eq!(finds("@duration:>=3s"), ids(&["fl_daemon", "fl_tunnel"]));
    assert_eq!(finds("@duration:<1m @duration:>1s"), ids(&["fl_daemon", "fl_tunnel"]));
    // A unit the field does not take matches nothing
    assert_eq!(finds("@duration:>1h"), ids(&[]));
    assert_eq!(finds("-@duration:*"), ids(&["fl_error", "fl_pending"]));
}

#[test]
fn times_ago_and_absolute() {
    assert_eq!(
        finds("@time:<5m"),
        ids(&[
            "fl_error",
            "fl_github",
            "fl_grpc",
            "fl_loop",
            "fl_pending",
            "fl_ws"
        ])
    );
    assert_eq!(finds("@time:<=30m @time:>5m"), ids(&["fl_stripe"]));
    assert_eq!(finds("@time:>1h"), ids(&["fl_daemon", "fl_tunnel"]));
    assert_eq!(finds("@time:>1d"), ids(&["fl_tunnel"]));
    assert_eq!(finds("@time:[1h TO 2h]"), ids(&["fl_daemon"]));
    assert_eq!(finds("@time:<1w"), finds("@time:*"));
    // An instant with its offset
    assert_eq!(finds("@time:<2026-11-07T11:00:00Z"), ids(&["fl_daemon", "fl_tunnel"]));
    assert_eq!(
        finds("@time:>=2026-11-07T11:30:00Z @time:<2026-11-07T11:58:00Z"),
        ids(&["fl_error", "fl_stripe"])
    );
    // Local: the day the fixture's now falls on holds all but the tunnel
    let today = now().with_timezone(&Local).format("%Y-%m-%d").to_string();
    let yesterday_ish = finds(&format!("@time:<{today}"));
    let on_day = finds(&format!("@time:{today}"));
    assert_eq!(yesterday_ish.len() + on_day.len(), fixture().len(), "{yesterday_ish:?} {on_day:?}");
    assert!(yesterday_ish.contains(&"fl_tunnel".to_string()));
    // A time today, local: the minute two minutes before now holds the GitHub flow
    let minute = (now() - Duration::minutes(2)).with_timezone(&Local).format("%H:%M").to_string();
    let by_minute = finds(&format!("@time:{minute}"));
    if (now() - Duration::minutes(2)).with_timezone(&Local).date_naive()
        == now().with_timezone(&Local).date_naive()
    {
        assert_eq!(by_minute, ids(&["fl_github"]));
    }
    // A time that is none of these matches nothing
    assert_eq!(finds("@time:soon"), ids(&[]));
    assert_eq!(finds("@time:5m"), ids(&[]));
}

#[test]
fn sources() {
    assert_eq!(finds("@app:\"google chrome\""), ids(&["fl_github"]));
    assert_eq!(finds("@app:com.google.Chrome"), ids(&["fl_github"]));
    assert_eq!(finds("@app:chrome"), ids(&[]));
    assert_eq!(finds("@app:*chrome*"), ids(&["fl_github"]));
    // A program outside an app, by its name, its path or its folder
    assert_eq!(finds("@app:curl"), ids(&["fl_stripe"]));
    assert_eq!(finds("@app:/usr/bin/curl"), ids(&["fl_stripe"]));
    assert_eq!(finds("@app:FIELDWORK"), ids(&["fl_stripe"]));
    assert_eq!(finds("@cwd:fieldwork"), ids(&["fl_stripe"]));
    assert_eq!(finds("@cwd:/Users/ada/src/fieldwork"), ids(&["fl_stripe"]));
    assert_eq!(finds("@cwd:*"), ids(&["fl_daemon", "fl_stripe"]));
    assert_eq!(finds("@pid:501"), ids(&["fl_github"]));
}

#[test]
fn headers_on_either_side_or_one() {
    assert_eq!(finds("@header.x-cache:hit"), ids(&["fl_github"]));
    assert_eq!(finds("@header.X-CACHE:*"), ids(&["fl_github", "fl_stripe"]));
    assert_eq!(finds("@res.header.x-cache:*"), ids(&["fl_github", "fl_stripe"]));
    assert_eq!(finds("@req.header.x-cache:*"), ids(&[]));
    assert_eq!(finds("@header.content-type:json"), ids(&["fl_daemon", "fl_github"]));
    assert_eq!(finds("@req.header.content-type:json"), ids(&["fl_daemon"]));
    assert_eq!(finds("@res.header.content-type:json"), ids(&["fl_github"]));
    assert_eq!(finds("@header.accept:application/*"), ids(&["fl_github"]));
    assert_eq!(finds("@header:miss"), ids(&["fl_stripe"]));
    assert_eq!(
        finds("-@header.x-cache:hit"),
        ids(&[
            "fl_daemon",
            "fl_error",
            "fl_grpc",
            "fl_loop",
            "fl_pending",
            "fl_stripe",
            "fl_tunnel",
            "fl_ws"
        ])
    );
}

/// `@is:encrypted` finds tunnelled connections, as `@is:tunnelled` did and still does, and
/// `@is:rejected` refused handshakes; hiding encrypted connections leaves them out unless the
/// query names them.
#[test]
fn encrypted_and_rejected() {
    let rejected = Flow {
        id: "fl_rejected".into(),
        url: "https://my.1password.com".into(),
        client_http_version: "HTTP/1.1".into(),
        tls_rejected: Some("unknown_ca".into()),
        error: Some("Rejected the proxy's certificate".into()),
        elapsed_ms: Some(3),
        started_at: (now() - Duration::minutes(5)).naive_utc(),
        ..Default::default()
    };
    let mut flows = fixture();
    flows.push(rejected);
    let (_dir, db, flows) = db_of(flows);
    let find = |query: &str, hidden: Hidden| {
        let prepared = FlowQuery::at(query, hidden, now());
        let sql = sql_ids(&db, &prepared);
        assert_eq!(sql, memory_ids(&flows, &prepared), "the two disagree on {query:?}");
        sql
    };
    let none = Hidden::default();
    let encrypted = Hidden { system: false, encrypted: true };
    assert_eq!(find("@is:encrypted", none), ids(&["fl_tunnel"]));
    assert_eq!(find("@is:tunnelled", none), ids(&["fl_tunnel"]));
    assert_eq!(find("@is:TUNNELLED", none), ids(&["fl_tunnel"]));
    assert_eq!(find("@is:rejected", none), ids(&["fl_rejected"]));
    assert!(find("@is:error", none).contains(&"fl_rejected".to_string()));
    // Hidden, unless named.
    let all = find("", none);
    let shown = find("", encrypted);
    assert_eq!(shown.len(), all.len() - 1);
    assert!(!shown.contains(&"fl_tunnel".to_string()));
    assert_eq!(find("@is:encrypted", encrypted), ids(&["fl_tunnel"]));
    assert_eq!(find("@is:tunnelled", encrypted), ids(&["fl_tunnel"]));
    assert_eq!(find("bank", encrypted), Vec::<String>::new());
    // Both hidden.
    let both = find("", Hidden { system: true, encrypted: true });
    assert_eq!(both.len(), all.len() - 2);
    assert_eq!(diagnostics("@is:encrypted @is:rejected @is:tunnelled"), vec![]);
    assert!(FLAGS.contains(&"encrypted") && FLAGS.contains(&"rejected"));
    assert!(!FLAGS.contains(&"tunnelled"), "an alias, not offered");
}

#[test]
fn flags() {
    assert_eq!(finds("@is:system"), ids(&["fl_daemon"]));
    assert_eq!(finds("@is:tunnelled"), ids(&["fl_tunnel"]));
    assert_eq!(finds("@is:error"), ids(&["fl_error", "fl_grpc"]));
    assert_eq!(finds("@is:pending"), ids(&["fl_pending"]));
    assert_eq!(finds("@is:saved"), ids(&["fl_github"]));
    assert_eq!(finds("@is:read"), ids(&["fl_pending"]));
    assert_eq!(finds("@is:loop"), ids(&["fl_loop"]));
    assert_eq!(finds("@is:ws"), ids(&["fl_ws"]));
    assert_eq!(finds("@is:sse"), ids(&[]));
    assert_eq!(finds("@is:GRPC"), ids(&["fl_grpc"]));
    assert_eq!(
        finds("@is:*"),
        ids(&[
            "fl_daemon",
            "fl_error",
            "fl_github",
            "fl_grpc",
            "fl_loop",
            "fl_pending",
            "fl_tunnel",
            "fl_ws"
        ])
    );
    assert_eq!(finds("@is:s*"), ids(&["fl_daemon", "fl_github"]));
    // Not yet, and not a flag
    assert_eq!(finds("@is:marked"), ids(&[]));
    assert_eq!(finds("@is:nope"), ids(&[]));
    assert_eq!(finds("-@is:nope").len(), fixture().len());
}

#[test]
fn groups_and_negation() {
    assert_eq!(finds("@status:4xx OR @is:tunnelled"), ids(&["fl_stripe", "fl_tunnel"]));
    assert_eq!(finds("(@status:4xx OR @is:tunnelled) -@method:connect"), ids(&["fl_stripe"]));
    assert_eq!(finds("-(@status:* OR @is:pending)"), ids(&["fl_error", "fl_tunnel"]));
    assert_eq!(finds("github -@host:github.com"), ids(&["fl_github"]));
    assert_eq!(
        finds("@host:*.example.com AND -@is:ws"),
        ids(&["fl_grpc", "fl_pending", "fl_tunnel"])
    );
}

#[test]
fn bodies_and_unknown_fields_match_nothing() {
    assert_eq!(finds("@body:x"), ids(&[]));
    assert_eq!(finds("@res.body:*"), ids(&[]));
    assert_eq!(finds("@nope:x"), ids(&[]));
    assert_eq!(finds("-@body:x").len(), fixture().len());
}

#[test]
fn hiding_system() {
    let all = fixture().len();
    assert_eq!(finds_with("", true).len(), all - 1);
    assert!(!finds_with("", true).contains(&"fl_daemon".to_string()));
    assert_eq!(finds_with("github", true), ids(&["fl_github"]));
    // The search names System itself, either way
    assert_eq!(finds_with("@is:system", true), ids(&["fl_daemon"]));
    assert_eq!(finds_with("github OR @is:System", true), ids(&["fl_daemon", "fl_github"]));
    assert_eq!(finds_with("-@is:system", true).len(), all - 1);
    assert!(FlowQuery::new("", true).matcher().matches(&document(&fixture()[0])));
    assert!(!FlowQuery::new("", true).is_empty());
    assert!(FlowQuery::new(" ", false).is_empty());
}

#[test]
fn diagnostics_mark_what_cannot_run() {
    let kinds =
        |q: &str| diagnostics(q).into_iter().map(|d| (d.kind, d.start, d.end)).collect::<Vec<_>>();
    use QueryDiagnosticKind::*;
    assert_eq!(kinds("@status:4xx @time:<5m @host:*.a.com"), vec![]);
    assert_eq!(kinds("@nope:x"), vec![(UnknownField, 0, 6)]);
    assert_eq!(kinds("@size:>5parsecs"), vec![(InvalidValue, 6, 15)]);
    assert_eq!(kinds("@time:soon"), vec![(InvalidValue, 6, 10)]);
    assert_eq!(kinds("@is:nope"), vec![(InvalidValue, 4, 8)]);
    assert_eq!(kinds("@is:marked"), vec![(NotYet, 0, 10)]);
    assert_eq!(kinds("x @body:token"), vec![(NotYet, 2, 13)]);
    // Spans count UTF-16 units
    assert_eq!(kinds("é😀 @nope:x"), vec![(UnknownField, 4, 10)]);
    // Typing a field is not yet a mistake
    assert_eq!(kinds("@is:"), vec![]);
    assert_eq!(kinds("@time:"), vec![]);
}

#[test]
fn time_is_compared_as_stored() {
    // The database compares `started_at` as text: what this writes must be how it is stored.
    let (_dir, db, flows) = db_of(fixture());
    let stored: Vec<String> = db.with_conn(|c| {
        let conn = c.conn().resolve();
        let mut stmt = conn.prepare("SELECT started_at FROM flows ORDER BY rowid").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    });
    for (flow, stored) in flows.iter().zip(stored) {
        assert_eq!(stored_time(started_ms(&flow.started_at)), stored);
    }
    let precise =
        NaiveDateTime::parse_from_str("2026-11-07 10:00:00.123456", "%Y-%m-%d %H:%M:%S%.f")
            .unwrap();
    assert_eq!(stored_time(started_ms(&precise)), "2026-11-07 10:00:00.123456");
}

#[test]
fn reads_url_parts() {
    assert_eq!(url_hostname("https://user:pw@API.Example.com:8443/x"), "api.example.com");
    assert_eq!(url_host("https://API.Example.com:8443/x"), "api.example.com:8443");
    assert_eq!(url_hostname("http://[::1]:8080/"), "[::1]");
    assert_eq!(url_port("http://[::1]:8080/"), Some(8080));
    assert_eq!(url_port("https://a.com/"), Some(443));
    assert_eq!(url_port("bank.example.com:443"), Some(443));
    assert_eq!(url_scheme("bank.example.com:443"), None);
    assert_eq!(url_path("https://a.com/x/y?q=1#f"), Some("/x/y"));
    assert_eq!(url_path("https://a.com?q=1"), Some(""));
    assert_eq!(url_sidebar_path("https://a.com/v1//users/"), Some("/v1/users".into()));
    assert_eq!(url_sidebar_path("https://a.com/v1/users"), None);
    assert_eq!(url_sidebar_path("https://a.com"), None);
    assert_eq!(
        url_query("https://a.com/?A=1&b=%20two&a=3#f"),
        vec![
            ("a".to_string(), "1".to_string()),
            ("b".to_string(), " two".to_string()),
            ("a".to_string(), "3".to_string()),
        ]
    );
}

// -- The drift guard --

/// A small deterministic generator, so a failure names a flow that comes back every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.next() as usize % items.len()]
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
}

/// Flows as varied as the fields can tell apart: hosts with and without ports and schemes,
/// queries and their encodings, any case, text outside ASCII, every flag, and the empty cases.
fn sample(count: usize) -> Vec<Flow> {
    let mut rng = Rng(7);
    let hosts = [
        "https://api.github.com",
        "https://github.com",
        "http://API.Stripe.com:8080",
        "https://api.stripe.community",
        "http://localhost:3000",
        "https://[::1]:8443",
        "wss://ws.example.com",
        "https://café.example.org",
        "http://neverssl.com:80",
        "https://user:pw@intranet.local",
        "bank.example.com:443",
    ];
    let paths = [
        "",
        "/",
        "/v1/charges",
        "/v1/charges/ch_1",
        "/v1//users",
        "/repos/yaak",
        "/ÜBER/x",
        "/a%20b",
    ];
    let queries = [
        "",
        "?page=2",
        "?page=10&sort=Stars",
        "?q=%C3%A9t%C3%A9",
        "?a=1&a=2",
        "?flag",
        "?page=two",
    ];
    let methods = ["GET", "POST", "put", "DELETE", "CONNECT", "HEAD"];
    let statuses = [
        None,
        Some(101),
        Some(200),
        Some(204),
        Some(301),
        Some(404),
        Some(500),
        Some(503),
        Some(508),
    ];
    let types = [
        None,
        Some("application/json"),
        Some("Application/JSON; charset=UTF-8"),
        Some("text/html"),
        Some("image/png"),
        Some(""),
    ];
    let header_names = [
        "Content-Type",
        "accept",
        "X-Cache",
        "x-trace",
        "Set-Cookie",
        "ÉTAG",
    ];
    let header_values = [
        "application/json",
        "HIT",
        "miss",
        "",
        "a=1; Path=/",
        "200",
        "Wörld",
        "text/*",
    ];
    // Name, bundle id, path and working directory
    type App<'a> = (Option<&'a str>, Option<&'a str>, Option<&'a str>, Option<&'a str>);
    let apps: [App; 7] = [
        (None, None, None, None),
        (
            Some("Google Chrome"),
            Some("com.google.Chrome"),
            Some("/Applications/Google Chrome.app"),
            None,
        ),
        (Some("curl"), None, Some("/usr/bin/curl"), Some("/Users/ada/src/fieldwork")),
        (Some("node"), None, Some("/opt/homebrew/bin/node"), Some("/Users/ada/src/Ledger/")),
        (Some("nsurlsessiond"), None, Some("/usr/libexec/nsurlsessiond"), Some("/")),
        (Some("trustd"), None, Some("/somewhere/trustd"), None),
        (
            Some("Slack"),
            Some("com.tinyspeck.slackmacgap"),
            Some("/Applications/Slack.app"),
            Some("/tmp"),
        ),
    ];
    let versions = ["HTTP/1.1", "HTTP/2", "HTTP/1.0", ""];
    let streams = [
        None,
        None,
        None,
        Some(StreamKind::Websocket),
        Some(StreamKind::Sse),
        Some(StreamKind::Grpc),
        Some(StreamKind::GrpcWeb),
    ];
    let sizes = [0, 1, 999, 1000, 1001, 250_000, 1_000_000, 2_500_000_000];
    let elapsed = [
        None,
        Some(0),
        Some(12),
        Some(500),
        Some(501),
        Some(1500),
        Some(60_000),
        Some(61_000),
    ];
    let ages_s = [
        0, 30, 59, 60, 61, 299, 300, 301, 3599, 3600, 7200, 86_399, 86_400, 90_000, 700_000,
    ];

    (0..count)
        .map(|i| {
            let tunnelled = rng.chance(8);
            let url = if tunnelled {
                rng.pick(&["bank.example.com:443", "https://bank.example.com"]).to_string()
            } else {
                format!("{}{}{}", rng.pick(&hosts), rng.pick(&paths), rng.pick(&queries))
            };
            let headers = |rng: &mut Rng| {
                (0..rng.next() % 4)
                    .map(|_| {
                        header(rng.pick::<&str>(&header_names), rng.pick::<&str>(&header_values))
                    })
                    .collect::<Vec<_>>()
            };
            let (name, bundle, path, cwd) = *rng.pick(&apps);
            let age = *rng.pick(&ages_s) as i64;
            let started_at = (now()
                - Duration::seconds(age)
                - Duration::microseconds((rng.next() % 3) as i64 * 250))
            .naive_utc();
            Flow {
                id: format!("fl_{i:03}"),
                url,
                method: rng.pick(&methods).to_string(),
                status: *rng.pick(&statuses),
                content_type: rng.pick(&types).map(String::from),
                request_headers: headers(&mut rng),
                response_headers: headers(&mut rng),
                request_size: *rng.pick(&sizes),
                response_size: *rng.pick(&sizes),
                elapsed_ms: *rng.pick(&elapsed),
                started_at,
                client_http_version: rng.pick(&versions).to_string(),
                client_name: name.map(String::from),
                client_bundle_id: bundle.map(String::from),
                client_path: path.map(String::from),
                client_cwd: cwd.map(String::from),
                client_pid: rng.chance(50).then(|| (rng.next() % 1000) as i32),
                stream_kind: *rng.pick(&streams),
                grpc_status: *rng.pick(&[None, Some(0), Some(5)]),
                grpc_service: rng
                    .chance(20)
                    .then(|| rng.pick(&["pkg.Greeter", "Users"]).to_string()),
                grpc_method: rng.chance(20).then(|| rng.pick(&["SayHello", "getUser"]).to_string()),
                graphql_operation: rng
                    .chance(25)
                    .then(|| rng.pick(&["GetUser", "", "Feed +2", "createÉtat"]).to_string()),
                error: rng.chance(15).then(|| "connection reset".to_string()),
                cancelled: rng.chance(10),
                saved_request_id: rng.chance(15).then(|| "rq_x".to_string()),
                tunnelled,
                tls_rejected: rng
                    .chance(10)
                    .then(|| rng.pick(&["unknown_ca", "hang_up"]).to_string())
                    .filter(|_| !tunnelled),
                agent_read: rng.chance(20),
                ..Default::default()
            }
        })
        .collect()
}

/// Queries over every field kind and value shape, and the ways they combine.
const BATTERY: &[&str] = &[
    "",
    "github",
    "GITHUB stripe",
    "json",
    "post",
    "50",
    "é",
    "café",
    "\"api.github.com/repos\"",
    "\"GET\"",
    "%",
    "_",
    "@host:api.github.com",
    "@host:API.STRIPE.COM",
    "@host:api.stripe.com:8080",
    "@host:*.github.com",
    "@host:*.example.com",
    "@host:*stripe*",
    "@host:café.example.org",
    "@host:[::1]",
    "@host:*",
    "-@host:*.github.com",
    "@port:443",
    "@port:>=8000",
    "@port:[80 TO 3000]",
    "@port:*",
    "-@port:*",
    "@scheme:https",
    "@scheme:ws*",
    "-@scheme:*",
    "@path:/v1",
    "@path:/v1/*",
    "@path:/v1/charges/*",
    "@path:\"/v1/charges\"",
    "@path:*users*",
    "@path:/über/*",
    "@path:/",
    "@path:*",
    "@url:*page=*",
    "@url:\"%20\"",
    "@query.page:2",
    "@query.page:>3",
    "@query.page:[1 TO 5]",
    "@query.page:*",
    "@query.sort:STARS",
    "@query.q:été",
    "@query.a:2",
    "@query.flag:*",
    "@query:2",
    "-@query:*",
    "@method:get",
    "@method:P*",
    "@method:*",
    "@type:json",
    "@type:application/json",
    "@type:*json*",
    "@type:*",
    "-@type:*",
    "@proto:h1",
    "@proto:h2",
    "@proto:ws",
    "@proto:grpc",
    "@proto:sse",
    "-@proto:*",
    "@id:7",
    "@id:>20",
    "@id:[5 TO 9]",
    "@status:200",
    "@status:2xx",
    "@status:5XX",
    "@status:1xx",
    "@status:>=400",
    "@status:<300",
    "@status:[300 TO 499]",
    "@status:50*",
    "@status:*",
    "-@status:*",
    "@status:\"50\"",
    "@status:abc",
    "@status:4xy",
    "@size:>100kb",
    "@size:1000",
    "@size:1kb",
    "@size:>=1mb",
    "@size:[1b TO 1kb]",
    "@size:>2gb",
    "@req.size:<1kb",
    "@res.size:*",
    "@size:>5parsecs",
    "@duration:>500ms",
    "@duration:500",
    "@duration:>=1.5s",
    "@duration:[1s TO 1m]",
    "@duration:*",
    "-@duration:*",
    "@duration:>1h",
    "@time:<5m",
    "@time:<=1m",
    "@time:>1h",
    "@time:>=1d",
    "@time:[1m TO 1h]",
    "@time:[1h TO 1m]",
    "@time:<500ms",
    "@time:*",
    "@time:<2026-11-07T11:00:00Z",
    "@time:>2026-11-07T11:59:00Z",
    "@time:2026-11-07T11:59:59Z",
    "@time:2026-11-07",
    "@time:<2026-11-07",
    "@time:>=2026-11-06",
    "@time:11:59",
    "@time:>11:00",
    "@time:<=11:59:30",
    "@time:soon",
    "@app:\"google chrome\"",
    "@app:com.google.Chrome",
    "@app:curl",
    "@app:fieldwork",
    "@app:ledger",
    "@app:/usr/bin/curl",
    "@app:*",
    "@app:*o*",
    "-@app:*",
    "@cwd:fieldwork",
    "@cwd:/tmp",
    "@cwd:*",
    "@cwd:/",
    "@pid:>500",
    "@pid:*",
    "@header.content-type:json",
    "@header.Content-Type:*",
    "@header.x-cache:hit",
    "@header.x-cache:*",
    "-@header.x-cache:*",
    "@header.accept:text/*",
    "@header.étag:wörld",
    "@header.set-cookie:\"Path=/\"",
    "@header:miss",
    "@header:*",
    "@header:200",
    "@header.x-trace:>100",
    "@req.header.content-type:json",
    "@res.header.x-cache:*",
    "@res.header:hit",
    "-@req.header:*",
    "@is:system",
    "-@is:system",
    "@is:tunnelled",
    "@is:error",
    "@is:pending",
    "@is:saved",
    "@is:read",
    "@is:loop",
    "@is:ws",
    "@is:sse",
    "@is:grpc",
    "@is:graphql",
    "-@is:graphql",
    "@graphql.operation:getuser",
    "@graphql.operation:feed*",
    "@graphql.operation:*",
    "-@graphql.operation:*",
    "@graphql.operation:createétat",
    "@grpc.service:pkg.greeter",
    "@grpc.service:*",
    "@grpc.method:SayHello",
    "-@grpc.method:*",
    "@grpc.service:users @grpc.method:get*",
    "@is:*",
    "-@is:*",
    "@is:s*",
    "@is:marked",
    "@is:nope",
    "@body:x",
    "-@res.body:*",
    "@nope:x",
    "-@nope:x",
    "@status:4xx OR @is:tunnelled",
    "@is:encrypted",
    "-@is:encrypted",
    "@is:rejected",
    "@is:rejected OR @is:encrypted",
    "-@is:rejected @is:error",
    "@is:e*",
    "(@status:4xx OR @is:error) -@method:post",
    "-(@status:* OR @is:pending)",
    "github -@host:github.com",
    "@host:*.example.com AND -@is:ws",
    "(@app:curl OR @app:node) (@host:*.github.com OR @path:/v1/*)",
    "@app:Slack @host:a.com OR @app:Chrome @host:api.github.com",
    "-(-@is:system)",
    "json @size:>1kb OR @duration:<100ms @proto:h2",
];

#[test]
fn the_database_and_the_evaluator_find_the_same_flows() {
    let (_dir, db, flows) = db_of(sample(400));
    let mut checked = 0;
    for query in BATTERY {
        for (system, encrypted) in [(false, false), (true, false), (false, true), (true, true)] {
            let hidden = Hidden { system, encrypted };
            let prepared = FlowQuery::at(query, hidden, now());
            let sql = sql_ids(&db, &prepared);
            let memory = memory_ids(&flows, &prepared);
            if sql != memory {
                let only_sql: Vec<_> = sql.iter().filter(|id| !memory.contains(id)).collect();
                let only_memory: Vec<_> = memory.iter().filter(|id| !sql.contains(id)).collect();
                let example = only_sql
                    .first()
                    .or(only_memory.first())
                    .map(|id| flows.iter().find(|f| &&f.id == id).cloned());
                panic!(
                    "{query:?} ({hidden:?}): only in SQL {only_sql:?}, \
                    only in memory {only_memory:?}; e.g. {example:#?}"
                );
            }
            checked += 1;
        }
    }
    assert_eq!(checked, BATTERY.len() * 4);
    // The battery means something only if the sample spreads its answers.
    let spread = BATTERY
        .iter()
        .map(|q| sql_ids(&db, &FlowQuery::at(q, false, now())).len())
        .filter(|n| *n > 0 && *n < flows.len())
        .count();
    assert!(spread > BATTERY.len() * 2 / 3, "only {spread} queries split the sample");
}

/// Live flows are matched as the list is: a flow's event and a listing agree.
#[test]
fn live_search_matches_as_the_list_does() {
    let live = LiveSearch::default();
    let flow = fixture().remove(0);
    assert_eq!(live.check(&flow), None);
    live.watch(Some(("k1".into(), "@status:2xx @host:*.github.com".into(), false.into())));
    assert_eq!(live.check(&flow), Some(SearchMatch { key: "k1".into(), matches: true }));
    live.watch(Some(("k2".into(), "@status:4xx".into(), false.into())));
    let payload = live.payload(flow, true);
    assert_eq!(payload.search, Some(SearchMatch { key: "k2".into(), matches: false }));
    live.watch(None);
    assert_eq!(live.check(&payload.model), None);
}

#[test]
fn seen_values_for_completion() {
    let (_dir, db, _) = db_of(fixture());
    let values = |path: &str| seen_values(&db, path).unwrap();
    let mut hosts = values("host");
    hosts.sort();
    assert!(hosts.contains(&"api.stripe.com:8080".to_string()), "{hosts:?}");
    assert_eq!(values("method").len(), 3);
    assert!(values("status").contains(&"404".to_string()));
    let types = values("type");
    assert!(types.contains(&"application/json".to_string()), "{types:?}");
    assert!(types.contains(&"text/html".to_string()), "{types:?}");
    assert_eq!(values("cwd"), vec!["fieldwork".to_string()]);
    assert!(values("app").contains(&"Google Chrome".to_string()));
    assert_eq!(values("is"), FLAGS.iter().map(|f| f.to_string()).collect::<Vec<_>>());
    let mut names = values("header");
    names.sort();
    assert_eq!(names, vec!["accept", "content-type", "x-cache"]);
    let mut response_names = values("res.header");
    response_names.sort();
    assert_eq!(response_names, vec!["content-type", "x-cache"]);
    let mut cache = values("header.X-Cache");
    cache.sort();
    assert_eq!(cache, vec!["HIT", "MISS"]);
    // Near-unique fields offer nothing
    for path in [
        "url",
        "path",
        "id",
        "pid",
        "size",
        "duration",
        "time",
        "query.page",
    ] {
        assert!(values(path).is_empty(), "{path}");
    }
    // A query parameter's names, for `@query.`, but not its values
    let mut params = values("query");
    params.sort();
    assert_eq!(params, vec!["page", "sort"]);
}

/// GraphQL operations and gRPC calls, by name and by flag, and offered for completion.
#[test]
fn graphql_and_grpc_fields() {
    let base = |id: &str, url: &str| Flow {
        id: id.into(),
        url: url.into(),
        method: "POST".into(),
        started_at: now().naive_utc(),
        ..Default::default()
    };
    let flows = vec![
        Flow {
            graphql_operation: Some("GetUser".into()),
            ..base("fl_named", "https://api.example.com/graphql")
        },
        Flow {
            graphql_operation: Some(String::new()),
            ..base("fl_anonymous", "https://api.example.com/graphql")
        },
        Flow {
            grpc_service: Some("pkg.Greeter".into()),
            grpc_method: Some("SayHello".into()),
            ..base("fl_call", "https://grpc.example.com/pkg.Greeter/SayHello")
        },
        base("fl_plain", "https://example.com/"),
    ];
    let (_dir, db, all) = db_of(flows);
    let finds = |query: &str| {
        let prepared = FlowQuery::at(query, false, now());
        let sql = sql_ids(&db, &prepared);
        assert_eq!(sql, memory_ids(&all, &prepared), "the two disagree on {query:?}");
        sql
    };
    assert_eq!(finds("@is:graphql"), ids(&["fl_anonymous", "fl_named"]));
    assert_eq!(finds("@graphql.operation:getuser"), ids(&["fl_named"]));
    assert_eq!(finds("@graphql.operation:*"), ids(&["fl_named"]));
    assert_eq!(finds("@grpc.service:pkg.Greeter"), ids(&["fl_call"]));
    assert_eq!(finds("@grpc.method:say*"), ids(&["fl_call"]));
    assert_eq!(finds("-@grpc.method:*"), ids(&["fl_anonymous", "fl_named", "fl_plain"]));
    assert_eq!(seen_values(&db, "graphql.operation").unwrap(), vec!["GetUser"]);
    assert_eq!(seen_values(&db, "grpc.service").unwrap(), vec!["pkg.Greeter"]);
    assert_eq!(seen_values(&db, "grpc.method").unwrap(), vec!["SayHello"]);
}

#[test]
fn a_header_with_many_values_offers_none() {
    let flows = (0..25)
        .map(|i| Flow {
            id: format!("fl_{i}"),
            url: "https://a.com/".into(),
            response_headers: vec![
                header("Date", &format!("day {i}")),
                header("Server", "nginx"),
            ],
            ..Default::default()
        })
        .collect();
    let (_dir, db, _) = db_of(flows);
    assert!(seen_values(&db, "header.date").unwrap().is_empty());
    assert_eq!(seen_values(&db, "res.header.server").unwrap(), vec!["nginx"]);
}

/// Completion shows each field with what it is and a term using it, and every such term runs.
#[test]
fn fields_have_descriptions_and_examples_that_run() {
    for field in &schema().fields {
        assert!(field.info.as_deref().is_some_and(|i| !i.is_empty()), "{}", field.name);
        if FIELDS_NOT_YET.contains(&field.name.as_str()) {
            continue;
        }
        let example = field.example.as_deref().unwrap_or_else(|| panic!("{}", field.name));
        assert!(example.contains(&format!("@{}", field.name)), "{example}");
        assert_eq!(diagnostics(example), vec![], "{example}");
    }
}
