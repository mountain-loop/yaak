mod common;

use common::http_server::TestHttpServer;
use common::{cli_cmd, query_manager, seed_workspace};
use predicates::str::contains;
use tempfile::TempDir;
use yaak_models::models::{HttpAssertion, HttpAssertions, HttpRequest};
use yaak_models::util::UpdateSource;

fn request(id: &str, url: &str, expected: &str) -> HttpRequest {
    HttpRequest {
        id: id.into(),
        workspace_id: "wk_test".into(),
        url: url.into(),
        name: "SECRET_REQUEST_NAME".into(),
        assertions: HttpAssertions {
            version: 1,
            checks: vec![HttpAssertion {
                id: "assertion".into(),
                selector: "$.token".into(),
                expected: expected.into(),
                ..Default::default()
            }],
        },
        ..Default::default()
    }
}
fn save(dir: &std::path::Path, request: &HttpRequest) {
    query_manager(dir).with_tx(|tx| tx.upsert_http_request(request, &UpdateSource::Sync)).unwrap();
}

#[test]
fn sends_assertions_persists_snapshots_and_writes_safe_reports() {
    let dir = TempDir::new().unwrap();
    seed_workspace(dir.path(), "wk_test");
    let server = TestHttpServer::spawn_ok(r#"{"token":"SECRET_TOKEN"}"#);
    let mut req = request("rq_test", &server.url, "SECRET_TOKEN");
    save(dir.path(), &req);
    cli_cmd(dir.path())
        .args(["test", "rq_test", "--environment", "missing"])
        .assert()
        .code(2)
        .stderr(contains("Selected environment"));
    assert!(
        query_manager(dir.path())
            .connect()
            .list_http_responses("wk_test", None)
            .unwrap()
            .is_empty()
    );
    let json = dir.path().join("results.json");
    let junit = dir.path().join("results.xml");
    let output = cli_cmd(dir.path())
        .args(["test", "rq_test", "--json"])
        .arg(&json)
        .arg("--junit")
        .arg(&junit)
        .assert()
        .success()
        .stdout(contains("1 passed, 0 failed"))
        .get_output()
        .clone();
    for text in [
        String::from_utf8_lossy(&output.stdout).into_owned(),
        std::fs::read_to_string(&json).unwrap(),
        std::fs::read_to_string(&junit).unwrap(),
    ] {
        assert!(!text.contains("SECRET"));
        assert!(!text.contains(&server.url));
        assert!(!text.contains("$.token"));
    }
    let report: serde_json::Value = serde_json::from_slice(&std::fs::read(json).unwrap()).unwrap();
    assert_eq!(report["requests"][0]["checks"][0]["outcome"], "passed");
    let manager = query_manager(dir.path());
    let history = manager.connect().list_http_responses("wk_test", None).unwrap();
    assert_eq!(history.len(), 1);
    let original_id = history[0].id.clone();
    assert_eq!(history[0].assertion_results.as_ref().unwrap().definition, req.assertions);
    req.assertions.checks[0].expected = "DIFFERENT_SECRET".into();
    save(dir.path(), &req);
    assert_eq!(
        manager
            .connect()
            .get_http_response(&original_id)
            .unwrap()
            .assertion_results
            .unwrap()
            .definition
            .checks[0]
            .expected,
        "SECRET_TOKEN"
    );
    cli_cmd(dir.path()).args(["test", "rq_test"]).assert().code(1).stdout(contains("1 failed"));
    // Ordinary send still prints the response body and succeeds even when a check fails.
    cli_cmd(dir.path())
        .args(["send", "rq_test"])
        .assert()
        .success()
        .stdout(contains("SECRET_TOKEN"));
}

#[test]
fn invalid_suite_and_empty_suite_do_not_send_and_fail_fast_records_skips() {
    let dir = TempDir::new().unwrap();
    seed_workspace(dir.path(), "wk_test");
    let server = TestHttpServer::spawn_ok(r#"{"token":"actual"}"#);
    let mut first = request("rq_a", &server.url, "different");
    first.sort_priority = 0.0;
    let mut second = request("rq_b", &server.url, "actual");
    second.sort_priority = 1.0;
    second.assertions.checks[0].selector = "$[".into();
    save(dir.path(), &first);
    save(dir.path(), &second);
    cli_cmd(dir.path())
        .args(["test", "wk_test"])
        .assert()
        .code(2)
        .stderr(contains("valid JSONPath"));
    assert!(
        query_manager(dir.path())
            .connect()
            .list_http_responses("wk_test", None)
            .unwrap()
            .is_empty()
    );
    second.assertions.checks[0].selector = "token".into();
    save(dir.path(), &second);
    let json = dir.path().join("results.json");
    cli_cmd(dir.path())
        .args(["test", "wk_test", "--fail-fast", "--json"])
        .arg(&json)
        .assert()
        .code(1)
        .stdout(contains("1 failed, 0 errors, 0 unchecked, 1 skipped"));
    let report: serde_json::Value = serde_json::from_slice(&std::fs::read(json).unwrap()).unwrap();
    assert_eq!(report["requests"][1]["requestId"], "rq_b");
    assert_eq!(report["requests"][1]["outcome"], "skipped");
    assert_eq!(
        query_manager(dir.path()).connect().list_http_responses("wk_test", None).unwrap().len(),
        1
    );
    first.assertions.checks.clear();
    save(dir.path(), &first);
    cli_cmd(dir.path())
        .args(["test", "rq_a"])
        .assert()
        .code(2)
        .stderr(contains("no enabled assertions"));
}

#[test]
fn transport_errors_are_distinct_from_failed_comparisons() {
    let dir = TempDir::new().unwrap();
    seed_workspace(dir.path(), "wk_test");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    save(dir.path(), &request("rq_error", &url, "SECRET"));
    cli_cmd(dir.path())
        .args(["test", "rq_error"])
        .assert()
        .code(1)
        .stdout(contains("0 failed, 1 errors"));
}
