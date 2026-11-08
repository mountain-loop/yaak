//! Captured traffic encrypted at rest: `proxy.db` and `blobs.sqlite` with SQLCipher, keyed from
//! a data key the master key in the keychain wraps, and `ca.key` with the data key.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use yaak_crypto::data_key::DataKey;
use yaak_database::UpdateSource;
use yaak_database::encryption::{FileState, apply_key, file_state};
use yaak_models::blob_manager::BodyChunkWriter;
use yaak_proxy::CaStore;
use yaak_proxy_lib::bodies::read_raw_body;
use yaak_proxy_lib::client::ProxyConnection;
use yaak_proxy_lib::db::{BLOBS_DB, DATA_KEY, PROXY_DB, database_key};
use yaak_proxy_lib::flows::{self, FlowFilter};
use yaak_proxy_lib::models::{Flow, FlowBody, ProxyHeader};
use yaak_proxy_lib::settings::ProxySettings;
use yaak_proxy_lib::{MasterKeySource, ProxyCtx};
use yaak_rpc::RpcEventEmitter;

const HEADER_SECRET: &str = "sk_live_HEADERSECRET123";
const QUERY_SECRET: &str = "QUERYSECRET456";
const BODY_SECRET: &str = "BODYSECRET789";
const FLOWS: usize = 3_000;

fn open_ctx(dir: &Path, keys: MasterKeySource) -> ProxyCtx {
    let settings = ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.join("settings.json")).unwrap();
    let (events, _rx) = RpcEventEmitter::new();
    ProxyCtx::new(dir, events, keys).unwrap()
}

/// `n` flows, each with a bearer token in a header, an API key in its query and a token in a
/// 1 KB response body.
fn write_flows(ctx: &ProxyCtx, n: usize) {
    let flows: Vec<Flow> = (0..n)
        .map(|i| Flow {
            id: format!("fl_{i:05}"),
            method: if i % 3 == 0 { "POST" } else { "GET" }.into(),
            url: format!("https://api.example.com/v1/items/{i}?api_key={QUERY_SECRET}"),
            status: Some(if i % 10 == 0 { 404 } else { 200 }),
            content_type: Some("application/json".into()),
            request_headers: vec![ProxyHeader {
                name: "authorization".into(),
                value: format!("Bearer {HEADER_SECRET}"),
            }],
            started_at: chrono::DateTime::from_timestamp(1_700_000_000 + i as i64, 0)
                .unwrap()
                .naive_utc(),
            elapsed_ms: Some(5),
            ..Default::default()
        })
        .collect();
    ctx.db()
        .unwrap()
        .with_tx(|tx| {
            flows.iter().try_for_each(|f| tx.upsert(f, &UpdateSource::Background).map(|_| ()))
        })
        .unwrap();
    for flow in &flows {
        let mut writer =
            BodyChunkWriter::new(ctx.blobs().unwrap(), Flow::body_id(&flow.id, FlowBody::Response));
        let body = format!("{{\"token\":\"{BODY_SECRET}\",\"pad\":\"{}\"}}", "x".repeat(1000));
        writer.write(body.as_bytes()).unwrap();
        writer.finish().unwrap();
    }
}

/// Every file under `dir`, recursively.
fn files(dir: &Path) -> Vec<PathBuf> {
    let mut found = vec![];
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            found.extend(files(&path));
        } else {
            found.push(path);
        }
    }
    found
}

/// The files under `dir` that hold `needle` as it is. One gone by the time it is read, a WAL
/// its last connection closed meanwhile, holds nothing.
fn holding(dir: &Path, needle: &str) -> Vec<PathBuf> {
    files(dir)
        .into_iter()
        .filter(|p| {
            std::fs::read(p)
                .map(|b| b.windows(needle.len()).any(|w| w == needle.as_bytes()))
                .unwrap_or(false)
        })
        .collect()
}

fn assert_no_plaintext(dir: &Path) {
    for secret in [HEADER_SECRET, QUERY_SECRET, BODY_SECRET, "PRIVATE KEY"] {
        assert_eq!(holding(dir, secret), Vec::<PathBuf>::new(), "{secret} in plaintext");
    }
}

/// `dir`'s databases as a build from before encryption left them: the same tables and rows,
/// plain, with a plaintext CA key.
fn make_plain(dir: &Path, keys: &MasterKeySource) {
    let data_key = DataKey::load_file(keys, &dir.join(DATA_KEY)).unwrap().unwrap();
    let key = database_key(&data_key);
    for name in [PROXY_DB, BLOBS_DB] {
        let path = dir.join(name);
        let plain = dir.join(format!("{name}.plain-export"));
        let conn = rusqlite::Connection::open(&path).unwrap();
        apply_key(&conn, &key).unwrap();
        conn.execute("ATTACH DATABASE ?1 AS plain KEY ''", [plain.to_string_lossy()]).unwrap();
        conn.query_row("SELECT sqlcipher_export('plain')", [], |_| Ok(())).unwrap();
        conn.execute_batch("DETACH DATABASE plain").unwrap();
        drop(conn);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(dir.join(format!("{name}{suffix}")));
        }
        std::fs::rename(&plain, &path).unwrap();
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
    }
    std::fs::remove_file(dir.join(DATA_KEY)).unwrap();
    // The CA as it was written before: its key in plaintext PEM.
    let ca_dir = dir.join("ca");
    std::fs::remove_dir_all(&ca_dir).ok();
    CaStore::load_or_create(&ca_dir).unwrap();
}

/// A data directory with `FLOWS` flows in plain databases, as before encryption.
fn plain_capture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let keys = MasterKeySource::memory();
    let ctx = open_ctx(dir.path(), keys.clone());
    write_flows(&ctx, FLOWS);
    drop(ctx);
    make_plain(dir.path(), &keys);
    assert!(!holding(dir.path(), BODY_SECRET).is_empty());
    assert!(!holding(dir.path(), "PRIVATE KEY").is_empty());
    dir
}

#[test]
fn stores_nothing_in_plaintext_and_reads_back_with_the_key() {
    let dir = tempfile::tempdir().unwrap();
    let keys = MasterKeySource::memory();
    let ctx = open_ctx(dir.path(), keys.clone());
    ctx.load_ca().unwrap();
    write_flows(&ctx, 20);
    // Through the WAL and checkpointed alike.
    assert_no_plaintext(dir.path());
    for name in [PROXY_DB, BLOBS_DB] {
        assert_eq!(file_state(&dir.path().join(name)).unwrap(), FileState::Encrypted);
    }
    drop(ctx);
    assert_no_plaintext(dir.path());

    // Opened again with the key, everything is there.
    let ctx = open_ctx(dir.path(), keys.clone());
    assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 20);
    let body = read_raw_body(&ctx.blobs().unwrap(), "fl_00007", FlowBody::Response).unwrap();
    assert!(String::from_utf8(body).unwrap().contains(BODY_SECRET));
    drop(ctx);

    // Read offline, as the CLI does, with the same keychain.
    let offline = ProxyConnection::Offline(
        yaak_proxy_lib::client::OfflineStore::open(dir.path(), &keys).unwrap(),
    );
    let rt = tokio::runtime::Runtime::new().unwrap();
    let listed = rt.block_on(offline.flows(&FlowFilter::default())).unwrap();
    assert_eq!(listed.len(), 20);

    // Without the master key that wraps it, nothing opens.
    let err = yaak_proxy_lib::client::OfflineStore::open(dir.path(), &MasterKeySource::memory())
        .err()
        .unwrap();
    assert!(err.contains("The encryption key is missing from the keychain"), "{err}");
    let err = yaak_proxy_lib::client::OfflineStore::open(
        dir.path(),
        &MasterKeySource::refusing("User canceled the operation"),
    )
    .err()
    .unwrap();
    assert!(err.contains("couldn't read its key from the keychain"), "{err}");
    // Nor without any key at all.
    let raw = rusqlite::Connection::open(dir.path().join(PROXY_DB)).unwrap();
    let err = raw.query_row("SELECT count(*) FROM flows", [], |r| r.get::<_, i64>(0)).unwrap_err();
    assert!(err.to_string().contains("file is not a database"), "{err}");
}

/// A capture from before encryption, 3,000 flows with bodies, is converted on first launch:
/// the engine starts once it is done, the app hears how far it has got, nothing is lost and no
/// secret is left readable in any file.
#[test]
fn converts_a_plain_capture_on_first_launch() {
    let dir = plain_capture();
    let pem_before = std::fs::read_to_string(dir.path().join("ca/ca.pem")).unwrap();
    let keys = MasterKeySource::memory();
    // Flows deleted since, as a clear leaves gaps in their numbers.
    let plain = rusqlite::Connection::open(dir.path().join(PROXY_DB)).unwrap();
    let deleted = plain.execute("DELETE FROM flows WHERE id < 'fl_00010'", []).unwrap();
    let number: i64 =
        plain.query_row("SELECT rowid FROM flows WHERE id = 'fl_01234'", [], |r| r.get(0)).unwrap();
    drop(plain);

    let ctx = open_ctx(dir.path(), keys.clone());
    let seen = Arc::new(Mutex::new(Vec::<f64>::new()));
    let watching = Arc::new(AtomicBool::new(true));
    let watcher = std::thread::spawn({
        let (ctx, seen, watching) = (ctx.clone(), seen.clone(), watching.clone());
        move || {
            while watching.load(Ordering::Relaxed) {
                if let Some(fraction) = ctx.encrypting() {
                    seen.lock().unwrap().push(fraction);
                }
                std::thread::sleep(Duration::from_micros(200));
            }
        }
    });
    // Waits for the conversion, then starts.
    ctx.start().unwrap();
    watching.store(false, Ordering::Relaxed);
    watcher.join().unwrap();
    assert!(ctx.port().is_some());
    assert_eq!(ctx.encrypting(), None);
    let seen = seen.lock().unwrap();
    assert!(!seen.is_empty(), "no progress shown");
    assert!(seen.iter().all(|f| (0.0..=1.0).contains(f)), "{seen:?}");

    for name in [PROXY_DB, BLOBS_DB] {
        assert_eq!(file_state(&dir.path().join(name)).unwrap(), FileState::Encrypted);
    }
    assert!(dir.path().join(DATA_KEY).exists());
    let leftovers: Vec<_> = files(dir.path())
        .into_iter()
        .filter(|p| {
            let name = p.file_name().unwrap().to_string_lossy();
            name.ends_with("-plain") || name.ends_with("-encrypting")
        })
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");

    // Every flow and body came across, each flow under its own number.
    assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), FLOWS - deleted);
    let body = read_raw_body(&ctx.blobs().unwrap(), "fl_02999", FlowBody::Response).unwrap();
    assert!(String::from_utf8(body).unwrap().contains(BODY_SECRET));
    let flow = flows::get(&ctx.db().unwrap(), "fl_01234").unwrap();
    assert_eq!(flow.request_headers[0].value, format!("Bearer {HEADER_SECRET}"));
    assert_eq!(flow.number, number);
    // The same CA, so it stays trusted, its key now encrypted.
    let ca = ctx.load_ca().unwrap();
    assert_eq!(ca.pem(), pem_before);

    ctx.stop().unwrap();
    drop(ctx);
    assert_no_plaintext(dir.path());
}

/// Search, the `q` filter, paging and the sidebar's filters read the encrypted database as
/// they read a plain one, and a full-text table works inside it.
#[test]
fn search_reaches_inside_the_encrypted_database() {
    let dir = plain_capture();
    let ctx = open_ctx(dir.path(), MasterKeySource::memory());
    ctx.load_ca().unwrap();
    let db = ctx.db().unwrap();

    // Query strings are searchable, being inside the encrypted file.
    let q = |q: &str| FlowFilter { limit: Some(50), ..FlowFilter::search(q) };
    let (page, total, matching) = flows::page(&db, &q(QUERY_SECRET)).unwrap();
    assert_eq!((page.len(), total, matching), (50, FLOWS, Some(FLOWS)));
    let (page, _, matching) = flows::page(&db, &q("items/2999")).unwrap();
    assert_eq!((page[0].id.as_str(), matching), ("fl_02999", Some(1)));
    let posts_not_found =
        FlowFilter { limit: Some(1), ..FlowFilter::search("@method:post @status:4xx") };
    let (_, _, matching) = flows::page(&db, &posts_not_found).unwrap();
    assert_eq!(matching, Some((0..FLOWS).filter(|i| i % 3 == 0 && i % 10 == 0).count()));

    // Paging back from the newest, as the list does.
    let mut before = None;
    let mut seen = 0;
    loop {
        let filter = FlowFilter { limit: Some(500), before: before.clone(), ..Default::default() };
        let (page, _, _) = flows::page(&db, &filter).unwrap();
        if page.is_empty() {
            break;
        }
        seen += page.len();
        before = page.last().map(|f| f.id.clone());
    }
    assert_eq!(seen, FLOWS);

    // The sidebar's host, site and path terms, which run the database's own functions.
    let found = |q: &str| flows::list(&db, &FlowFilter::search(q)).unwrap().len();
    assert_eq!(found("@host:api.example.com"), FLOWS);
    assert_eq!(found("@host:*.example.com"), FLOWS);
    assert_eq!(found("@host:api.example.com @path:/v1/items/42/*"), 1);

    // A full-text table, as body search will want, made and searched in the encrypted file.
    let hits: i64 = db
        .with_tx(|tx| {
            let conn = tx.conn().resolve();
            conn.execute_batch(&format!(
                "CREATE VIRTUAL TABLE fts_probe USING fts5(body);
                INSERT INTO fts_probe VALUES ('{{\"token\":\"{BODY_SECRET}\"}}'), ('nothing');"
            ))?;
            let hits = conn.query_row(
                &format!(
                    "SELECT count(*) FROM fts_probe WHERE fts_probe MATCH '\"{BODY_SECRET}\"'"
                ),
                [],
                |r| r.get(0),
            )?;
            conn.execute_batch("DROP TABLE fts_probe")?;
            Ok::<_, yaak_database::Error>(hits)
        })
        .unwrap();
    assert_eq!(hits, 1);
    drop((db, ctx));
    assert_no_plaintext(dir.path());
}

/// Two first launches at once, as the app and the CLI daemon might: one data key, one
/// conversion, one CA, and both read everything.
#[test]
fn concurrent_first_unlocks_agree() {
    let dir = plain_capture();
    let keys = MasterKeySource::memory();
    let barrier = std::sync::Barrier::new(2);
    let pems: Vec<String> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..2)
            .map(|_| {
                s.spawn(|| {
                    barrier.wait();
                    let ctx = open_ctx(dir.path(), keys.clone());
                    let pem = ctx.load_ca().unwrap().pem().to_string();
                    assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), FLOWS);
                    pem
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    assert_eq!(pems[0], pems[1]);
    let ctx = open_ctx(dir.path(), keys);
    assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), FLOWS);
    drop(ctx);
    assert_no_plaintext(dir.path());
}

/// A keychain that refuses leaves capture refused, saying why, and touches nothing: no key or
/// database is made, and traffic from before stays as it was until the key can be read.
#[test]
fn a_refused_key_refuses_capture() {
    let refusing = MasterKeySource::refusing("User canceled the operation");
    let empty = tempfile::tempdir().unwrap();
    let ctx = open_ctx(empty.path(), refusing.clone());
    let err = ctx.start().unwrap_err();
    assert_eq!(
        err,
        "Yaak Proxy stores traffic encrypted and couldn't read its key from the keychain: \
        Encryption error: User canceled the operation. Allow it access, then retry."
    );
    assert_eq!(ctx.start_error().as_deref(), Some(err.as_str()));
    assert_eq!(ctx.port(), None);
    assert!(ctx.load_ca().is_err());
    // Nothing is open: what reads or writes captured traffic is refused, saying why.
    let locked = ctx.db().err().unwrap();
    assert_eq!(locked.to_string(), format!("Traffic is locked: {err}"));
    assert!(ctx.blobs().is_err());
    let lock = ctx.locked().unwrap();
    assert!(lock.keychain);
    assert_eq!(lock.message, locked.to_string());
    let made: Vec<_> = files(empty.path())
        .into_iter()
        .filter(|p| p.extension().is_none_or(|e| e != "lock") && !p.ends_with("settings.json"))
        .collect();
    assert!(made.is_empty(), "{made:?}");

    let dir = plain_capture();
    let ctx = open_ctx(dir.path(), refusing);
    let refused = ctx.start().unwrap_err();
    assert_eq!(ctx.encrypting(), None);
    for name in [PROXY_DB, BLOBS_DB] {
        assert_eq!(file_state(&dir.path().join(name)).unwrap(), FileState::Plain);
    }
    // Clear is refused too, so the captured flows are not left to come back.
    assert_eq!(ctx.clear_flows().unwrap_err(), format!("Traffic is locked: {refused}"));
    // Retrying with access allowed converts it then, every flow still there.
    drop(ctx);
    let ctx = open_ctx(dir.path(), MasterKeySource::memory());
    ctx.start().unwrap();
    assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), FLOWS);
    // And clears them now.
    assert_eq!(ctx.clear_flows().unwrap(), FLOWS);
    assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 0);
}

/// A build from before encryption that owns the engine, a CLI daemon, keeps its plain databases
/// until it lets go: converting them under it would pull them away from its connections.
#[cfg(unix)]
#[test]
fn waits_for_an_older_owner_before_converting() {
    use yaak_proxy_lib::control::{ControlInfo, Owner, control_path};
    let dir = plain_capture();
    let ca_key = std::fs::read(dir.path().join("ca/ca.key")).unwrap();
    // Another live process owns it: this one's parent, answering on a port of its own.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let owner = ControlInfo {
        pid: std::os::unix::process::parent_id(),
        control_port: listener.local_addr().unwrap().port(),
        proxy_port: None,
        token: "tok".into(),
        owner: Owner::Cli,
        started_at: chrono::Utc::now(),
    };
    let control = control_path(dir.path());
    std::fs::write(&control, serde_json::to_string(&owner).unwrap()).unwrap();

    let ctx = open_ctx(dir.path(), MasterKeySource::memory());
    assert!(ctx.load_ca().err().unwrap().contains("can't be encrypted yet"));
    assert!(ctx.start().unwrap_err().starts_with("The proxy is already running in the yaak CLI"));
    for name in [PROXY_DB, BLOBS_DB] {
        assert_eq!(file_state(&dir.path().join(name)).unwrap(), FileState::Plain);
    }
    assert_eq!(std::fs::read(dir.path().join("ca/ca.key")).unwrap(), ca_key, "CA left as it was");

    // Once it has let go, starting converts them.
    drop(listener);
    std::fs::remove_file(&control).unwrap();
    ctx.start().unwrap();
    assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), FLOWS);
    for name in [PROXY_DB, BLOBS_DB] {
        assert_eq!(file_state(&dir.path().join(name)).unwrap(), FileState::Encrypted);
    }
}

/// The data key's file gone from beside encrypted databases is refused too, rather than a new
/// key being made that could open nothing and would replace the trusted CA.
#[test]
fn a_lost_data_key_is_not_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let keys = MasterKeySource::memory();
    let ctx = open_ctx(dir.path(), keys.clone());
    let pem = ctx.load_ca().unwrap().pem().to_string();
    write_flows(&ctx, 3);
    drop(ctx);

    std::fs::remove_file(dir.path().join(DATA_KEY)).unwrap();
    let ctx = open_ctx(dir.path(), keys);
    let err = ctx.start().unwrap_err();
    assert!(err.starts_with("The proxy's captured traffic is encrypted, but its key is missing"));
    assert!(!dir.path().join(DATA_KEY).exists());
    assert_eq!(std::fs::read_to_string(dir.path().join("ca/ca.pem")).unwrap(), pem);
    assert!(ctx.db().is_err(), "locked");
    assert!(!ctx.locked().unwrap().keychain, "not the keychain's doing");
}

/// While locked, every RPC that reads or writes captured traffic is refused with why, and so is
/// the control API, with 503; the proxy's state says so, and starting, once the key can be
/// read, opens the databases.
#[tokio::test(flavor = "multi_thread")]
async fn locked_rpcs_and_control_api_refuse() {
    let dir = plain_capture();
    let ctx = open_ctx(dir.path(), MasterKeySource::refusing("User canceled the operation"));
    let router = yaak_proxy_lib::build_router();
    let rpc = |cmd: &'static str, payload: serde_json::Value| {
        let (router, ctx) = (&router, ctx.clone());
        async move { router.dispatch(cmd, payload, &ctx).await.map_err(|e| e.message) }
    };
    let flow_id = "fl_00001";
    for (cmd, payload) in [
        ("list_flows", serde_json::json!({})),
        ("clear_flows", serde_json::json!({})),
        ("list_messages", serde_json::json!({ "flowId": flow_id })),
        ("get_flow_body", serde_json::json!({ "flowId": flow_id, "which": "response" })),
        ("preview_save", serde_json::json!({ "flowId": flow_id })),
        ("list_grpc_schemas", serde_json::json!({})),
        ("remove_grpc_schema", serde_json::json!({ "id": "gs_1" })),
        ("execute_action", serde_json::json!({ "scope": "global", "action": "flows_clear" })),
    ] {
        let err = rpc(cmd, payload).await.unwrap_err();
        assert!(err.starts_with("Traffic is locked: "), "{cmd}: {err}");
    }
    let state = rpc("get_proxy_state", serde_json::json!({})).await.unwrap();
    assert_eq!(state["locked"]["keychain"], true);
    assert!(state["locked"]["message"].as_str().unwrap().starts_with("Traffic is locked: "));

    ctx.serve_control_api().unwrap();
    let info = ctx.control_info().unwrap();
    let http = reqwest::Client::builder().no_proxy().build().unwrap();
    for path in ["/flows", &format!("/flows/{flow_id}"), "/har"] {
        let resp = http
            .get(format!("{}{path}", info.base_url()))
            .bearer_auth(&info.token)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 503, "{path}");
        assert!(resp.text().await.unwrap().contains("Traffic is locked: "), "{path}");
    }
    let cleared = http
        .post(format!("{}/flows/clear", info.base_url()))
        .bearer_auth(&info.token)
        .send()
        .await
        .unwrap();
    assert_eq!(cleared.status(), 503);
    // The status still answers, saying why.
    let status: serde_json::Value = http
        .get(format!("{}/status", info.base_url()))
        .bearer_auth(&info.token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["flowCount"], 0);
    assert!(status["locked"].as_str().unwrap().starts_with("Traffic is locked: "));
    ctx.stop_control_api();
    // Nothing was cleared or converted meanwhile.
    for name in [PROXY_DB, BLOBS_DB] {
        assert_eq!(file_state(&dir.path().join(name)).unwrap(), FileState::Plain);
    }
}
