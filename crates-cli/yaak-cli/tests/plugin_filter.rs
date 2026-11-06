mod common;

use common::http_server::TestHttpServer;
use common::{cli_cmd, query_manager, seed_workspace};
use predicates::str::contains;
use std::fs;
use tempfile::TempDir;
use yaak_models::models::{HttpRequest, HttpRequestHeader};
use yaak_models::util::UpdateSource;

/// A template function that runs `ctx.filter` and returns the host's reply as JSON.
const PROBE_PLUGIN: &str = r#"exports.plugin = {
  templateFunctions: [{
    name: "filter_probe",
    args: [
      { type: "text", name: "language" },
      { type: "text", name: "text" },
      { type: "text", name: "query" },
    ],
    async onRender(ctx, args) {
      const { language, text, query } = args.values;
      const result = language === "xpath"
        ? await ctx.filter.xPath(text, query)
        : await ctx.filter.jsonPath(text, query);
      return JSON.stringify(result);
    },
  }],
};"#;

/// The plugin runtime, the CLI's plugin host, and yaak-filter, end to end: the
/// rendered header values are what the host replied to the plugin.
#[test]
fn plugins_filter_text_through_the_host() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();

    // Bundled plugins are extracted next to this on launch; extras are kept.
    let probe_dir = data_dir.join("vendored-plugins").join("filter-probe");
    fs::create_dir_all(probe_dir.join("build")).expect("Failed to create probe plugin dir");
    fs::write(probe_dir.join("package.json"), r#"{"name":"@yaak/filter-probe","version":"0.0.0"}"#)
        .expect("Failed to write probe package.json");
    fs::write(probe_dir.join("build").join("index.js"), PROBE_PLUGIN)
        .expect("Failed to write probe plugin");

    seed_workspace(data_dir, "wk_test");
    let server = TestHttpServer::spawn_ok("ok");
    let header = |name: &str, value: &str| HttpRequestHeader {
        enabled: true,
        name: name.to_string(),
        value: value.to_string(),
        id: None,
    };
    let request = HttpRequest {
        id: "rq_filter".to_string(),
        workspace_id: "wk_test".to_string(),
        method: "GET".to_string(),
        url: server.url.clone(),
        headers: vec![
            header(
                "x-json",
                r#"${[ filter_probe(language='jsonpath', text='{"a":[1,2]}', query='$.a[1]') ]}"#,
            ),
            header(
                "x-xml",
                "${[ filter_probe(language='xpath', text='<a><b>x</b></a>', query='//b') ]}",
            ),
            header(
                "x-bad",
                "${[ filter_probe(language='jsonpath', text='{}', query='$[?(@ ==)]') ]}",
            ),
        ],
        ..Default::default()
    };
    query_manager(data_dir)
        .with_tx(|tx| tx.upsert_http_request(&request, &UpdateSource::Sync))
        .expect("Failed to seed request");

    cli_cmd(data_dir)
        .args(["--verbose", "request", "send", "rq_filter"])
        .assert()
        .success()
        .stdout(contains(r#"> x-json: {"content":"[\n  2\n]"}"#))
        .stdout(contains(r#"> x-xml: {"content":"<b>x</b>"}"#))
        .stdout(contains(r#"> x-bad: {"content":"","error":"Invalid filter: "#));
}
