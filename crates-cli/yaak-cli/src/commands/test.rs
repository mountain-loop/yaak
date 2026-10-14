use crate::cli::TestArgs;
use crate::commands::request::resolve_cookie_jar_id;
use crate::context::CliContext;
use serde::Serialize;
use std::collections::HashSet;
use yaak::send::{SendHttpRequestWithPluginsParams, send_http_request_with_plugins};
use yaak_assertions::{AssertionReport, HttpAssertions};
use yaak_models::models::{Folder, HttpRequest};
use yaak_models::queries::any_request::AnyRequest;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::PluginContext;

// Reports intentionally contain no names, URLs, selectors, expected/actual values, or transport
// error strings (which can embed URLs/tokens). The stored response has details for local inspection.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckResult {
    assertion_id: String,
    outcome: String,
    reason: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestResult {
    request_id: String,
    outcome: String,
    reason: String,
    checks: Vec<CheckResult>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunReport {
    version: u32,
    exit_code: i32,
    requests: Vec<RequestResult>,
}

pub async fn run(
    ctx: &CliContext,
    args: TestArgs,
    environment: Option<&str>,
    cookie_jar: Option<&str>,
) -> i32 {
    match run_inner(ctx, &args, environment, cookie_jar).await {
        Ok(report) => {
            if let Err(e) = write_reports(&args, &report) {
                eprintln!("Could not write test report: {e}");
                return 2;
            }
            for request in &report.requests {
                println!(
                    "{} {}: {}",
                    request.outcome.to_uppercase(),
                    request.request_id,
                    request.reason
                );
                for check in &request.checks {
                    println!(
                        "  {} {}: {}",
                        check.outcome.to_uppercase(),
                        check.assertion_id,
                        check.reason
                    );
                }
            }
            let count = |outcome| report.requests.iter().filter(|r| r.outcome == outcome).count();
            println!(
                "Test summary: {} passed, {} failed, {} errors, {} unchecked, {} skipped",
                count("passed"),
                count("failed"),
                count("error"),
                count("unchecked"),
                count("skipped")
            );
            report.exit_code
        }
        Err(error) => {
            eprintln!("Invalid test configuration: {error}");
            2
        }
    }
}

async fn run_inner(
    ctx: &CliContext,
    args: &TestArgs,
    environment: Option<&str>,
    cookie_jar: Option<&str>,
) -> Result<RunReport, String> {
    let (workspace_id, requests) = select_requests(ctx, &args.id)?;
    let jar = resolve_cookie_jar_id(ctx, &workspace_id, cookie_jar)?;
    if let Some(id) = environment {
        ctx.db().get_environment_for_workspace(&workspace_id, id).map_err(|_| {
            "Selected environment is missing or does not belong to this workspace".to_owned()
        })?;
    }
    // Validate the entire selection before sending anything, including unchecked setup requests.
    let mut enabled = 0;
    for request in &requests {
        yaak_assertions::validate(&request.assertions)
            .map_err(|e| format!("{}: {e}", request.id))?;
        enabled += request.assertions.checks.iter().filter(|c| c.enabled).count();
    }
    if enabled == 0 {
        return Err("Selected requests have no enabled assertions".into());
    }
    if args.json.is_some() && args.json == args.junit {
        return Err("JSON and JUnit reports require different files".into());
    }
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let cancel_task = tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            let _ = cancel_tx.send(true);
        }
    });
    let plugin_context = PluginContext::new(Some("cli".into()), Some(workspace_id));
    let response_dir = ctx.data_dir().join("responses");
    let mut report = RunReport { version: 1, exit_code: 0, requests: Vec::new() };
    let mut stopped = false;
    for request in requests {
        if stopped || *cancel_rx.borrow() {
            report.requests.push(skipped(
                &request.id,
                &request.assertions,
                if *cancel_rx.borrow() { "Canceled" } else { "Stopped after failure" },
            ));
            continue;
        }
        let id = request.id.clone();
        let definition = request.assertions.clone();
        let result = send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
            query_manager: ctx.query_manager(),
            blob_manager: ctx.blob_manager(),
            request,
            environment_id: environment,
            update_source: UpdateSource::Sync,
            cookie_jar_id: jar.clone(),
            response_dir: &response_dir,
            emit_events_to: None,
            emit_response_body_chunks_to: None,
            existing_response: None,
            plugin_manager: ctx.plugin_manager(),
            encryption_manager: ctx.encryption_manager.clone(),
            plugin_context: &plugin_context,
            cancelled_rx: Some(cancel_rx.clone()),
            connection_manager: ctx.connection_manager(),
        })
        .await;
        let request_result = match result {
            Ok(result) if result.response.error.is_none() && !*cancel_rx.borrow() => {
                summarize(&id, &definition, result.response.assertion_results.as_ref())
            }
            _ => RequestResult {
                request_id: id,
                outcome: "error".into(),
                reason: if *cancel_rx.borrow() {
                    "Request canceled"
                } else {
                    "Request did not complete successfully"
                }
                .into(),
                checks: definition
                    .checks
                    .iter()
                    .map(|c| CheckResult {
                        assertion_id: c.id.clone(),
                        outcome: if c.enabled { "error" } else { "skipped" }.into(),
                        reason: if c.enabled {
                            "Request did not complete successfully"
                        } else {
                            "Disabled"
                        }
                        .into(),
                    })
                    .collect(),
            },
        };
        if matches!(request_result.outcome.as_str(), "failed" | "error") {
            report.exit_code = 1;
            stopped = args.fail_fast;
        }
        report.requests.push(request_result);
    }
    if *cancel_rx.borrow() {
        report.exit_code = 130;
    }
    cancel_task.abort();
    Ok(report)
}

fn summarize(
    id: &str,
    definition: &HttpAssertions,
    report: Option<&AssertionReport>,
) -> RequestResult {
    let checks: Vec<CheckResult> = report
        .map(|r| {
            r.results
                .iter()
                .map(|c| CheckResult {
                    assertion_id: c.assertion_id.clone(),
                    outcome: c.outcome.clone(),
                    reason: c.reason.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    let enabled = definition.checks.iter().filter(|c| c.enabled).count();
    let (outcome, reason) = if report.is_some_and(|r| r.error.is_some())
        || checks.iter().any(|c| matches!(c.outcome.as_str(), "error" | "invalid"))
    {
        ("error", "Assertions could not be evaluated")
    } else if checks.iter().any(|c| c.outcome == "failed") {
        ("failed", "Assertions failed")
    } else if enabled == 0 {
        ("unchecked", "No enabled assertions")
    } else if checks.iter().filter(|c| c.outcome == "passed").count() != enabled {
        ("error", "Assertion results are incomplete")
    } else {
        ("passed", "All enabled assertions passed")
    };
    RequestResult { request_id: id.into(), outcome: outcome.into(), reason: reason.into(), checks }
}

fn skipped(id: &str, definition: &HttpAssertions, reason: &str) -> RequestResult {
    RequestResult {
        request_id: id.into(),
        outcome: "skipped".into(),
        reason: reason.into(),
        checks: definition
            .checks
            .iter()
            .map(|c| CheckResult {
                assertion_id: c.id.clone(),
                outcome: "skipped".into(),
                reason: reason.into(),
            })
            .collect(),
    }
}

fn select_requests(ctx: &CliContext, id: &str) -> Result<(String, Vec<HttpRequest>), String> {
    let db = ctx.db();
    if let Ok(request) = db.get_any_request(id) {
        return match request {
            AnyRequest::HttpRequest(r) => Ok((r.workspace_id.clone(), vec![r])),
            _ => Err("Assertions currently support HTTP requests only".into()),
        };
    }
    let (workspace_id, parent) = if let Ok(folder) = db.get_folder(id) {
        (folder.workspace_id, Some(folder.id))
    } else if let Ok(workspace) = db.get_workspace(id) {
        (workspace.id, None)
    } else {
        return Err("Could not resolve request, folder, or workspace".into());
    };
    let folders = db.list_folders(&workspace_id).map_err(|e| e.to_string())?;
    let requests = db.list_http_requests(&workspace_id).map_err(|e| e.to_string())?;
    // Refuse mixed protocols rather than silently producing a green partial suite.
    let mut folder_ids = HashSet::new();
    let ordered = ordered_requests(&folders, &requests, parent.as_deref(), &mut folder_ids)?;
    let selected = |folder: Option<&String>| {
        parent.is_none() || folder.is_some_and(|f| folder_ids.contains(f))
    };
    if db
        .list_grpc_requests(&workspace_id)
        .map_err(|e| e.to_string())?
        .iter()
        .any(|r| selected(r.folder_id.as_ref()))
        || db
            .list_websocket_requests(&workspace_id)
            .map_err(|e| e.to_string())?
            .iter()
            .any(|r| selected(r.folder_id.as_ref()))
    {
        return Err(
            "Selection includes gRPC or WebSocket requests; choose an HTTP request or folder"
                .into(),
        );
    }
    if parent.is_none() && ordered.len() != requests.len() {
        return Err("Request folder hierarchy is invalid".into());
    }
    Ok((workspace_id, ordered))
}

fn ordered_requests(
    folders: &[Folder],
    requests: &[HttpRequest],
    parent: Option<&str>,
    visited: &mut HashSet<String>,
) -> Result<Vec<HttpRequest>, String> {
    if let Some(id) = parent {
        if !visited.insert(id.to_owned()) {
            return Err("Request folder hierarchy contains a cycle".into());
        }
    }
    let mut children: Vec<_> = folders
        .iter()
        .filter(|f| f.folder_id.as_deref() == parent)
        .map(|f| (f.sort_priority, f.created_at, f.id.as_str(), None::<&HttpRequest>))
        .collect();
    children.extend(
        requests
            .iter()
            .filter(|r| r.folder_id.as_deref() == parent)
            .map(|r| (r.sort_priority, r.created_at, r.id.as_str(), Some(r))),
    );
    children.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(b.2)));
    let mut ordered = Vec::new();
    for (_, _, id, request) in children {
        if let Some(request) = request {
            ordered.push(request.clone());
        } else {
            ordered.extend(ordered_requests(folders, requests, Some(id), visited)?);
        }
    }
    Ok(ordered)
}

fn write_reports(args: &TestArgs, report: &RunReport) -> Result<(), String> {
    if let Some(path) = &args.json {
        std::fs::write(path, serde_json::to_vec_pretty(report).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    if let Some(path) = &args.junit {
        std::fs::write(path, junit(report)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn xml(s: &str) -> String {
    s.chars()
        .filter(|&c| {
            matches!(c, '\t' | '\n' | '\r') || c >= ' ' && c != '\u{fffe}' && c != '\u{ffff}'
        })
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn junit(report: &RunReport) -> String {
    let mut cases = Vec::new();
    for request in &report.requests {
        for check in &request.checks {
            cases.push((
                request.request_id.as_str(),
                check.assertion_id.as_str(),
                check.outcome.as_str(),
                check.reason.as_str(),
            ));
        }
        if request.checks.is_empty()
            || request.outcome == "error"
                && !request.checks.iter().any(|c| c.outcome == "error" || c.outcome == "invalid")
        {
            cases.push((
                request.request_id.as_str(),
                "request",
                if request.outcome == "unchecked" { "skipped" } else { &request.outcome },
                request.reason.as_str(),
            ));
        }
    }
    let count = |outcome| cases.iter().filter(|c| c.2 == outcome).count();
    let mut out = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuite name=\"Yaak\" tests=\"{}\" failures=\"{}\" errors=\"{}\" skipped=\"{}\">\n",
        cases.len(),
        count("failed"),
        count("error") + count("invalid"),
        count("skipped")
    );
    for (request, check, outcome, reason) in cases {
        out.push_str(&format!(
            "  <testcase classname=\"{}\" name=\"{}\">",
            xml(request),
            xml(check)
        ));
        let tag = match outcome {
            "failed" => Some("failure"),
            "error" | "invalid" => Some("error"),
            "skipped" => Some("skipped"),
            _ => None,
        };
        if let Some(tag) = tag {
            out.push_str(&format!("<{tag} message=\"{}\"/>", xml(reason)));
        }
        out.push_str("</testcase>\n");
    }
    out.push_str("</testsuite>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sidebar_order_interleaves_folders_and_requests() {
        let folders =
            vec![Folder { id: "folder".into(), sort_priority: 2.0, ..Default::default() }];
        let requests = vec![
            HttpRequest { id: "last".into(), sort_priority: 3.0, ..Default::default() },
            HttpRequest {
                id: "nested".into(),
                folder_id: Some("folder".into()),
                ..Default::default()
            },
            HttpRequest { id: "first".into(), sort_priority: 1.0, ..Default::default() },
        ];
        let ordered = ordered_requests(&folders, &requests, None, &mut HashSet::new()).unwrap();
        assert_eq!(
            ordered.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["first", "nested", "last"]
        );
    }
    #[test]
    fn junit_escapes_attributes_and_counts_all_outcomes() {
        let report = RunReport {
            version: 1,
            exit_code: 1,
            requests: vec![
                RequestResult {
                    request_id: "rq_<&\"".into(),
                    outcome: "failed".into(),
                    reason: "Assertions failed".into(),
                    checks: vec![CheckResult {
                        assertion_id: "check".into(),
                        outcome: "failed".into(),
                        reason: "Value did not match".into(),
                    }],
                },
                skipped("rq_skip", &HttpAssertions::default(), "Stopped after failure"),
            ],
        };
        let xml = junit(&report);
        assert!(xml.contains("tests=\"2\" failures=\"1\" errors=\"0\" skipped=\"1\""));
        assert!(xml.contains("classname=\"rq_&lt;&amp;&quot;\""));
        assert!(xml.contains("<skipped "));
    }
}
