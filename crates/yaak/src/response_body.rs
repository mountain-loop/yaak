//! Reading response bodies back out, by response id.
//!
//! Plugins only ever name a response. Where its bytes actually live — files the
//! engine wrote under `<data dir>/responses/<id>` today, blob rows later — is
//! behind [`ResponseBodyStore`], so moving the bytes is a change to this file
//! and nothing a plugin can see.
//!
//! Only saved responses are reachable by id. A send that saved nothing hands
//! its body back with the reply instead, which is the only copy of it there is.

use crate::error::Result;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use yaak_models::models::HttpResponseState;
use yaak_models::query_manager::QueryManager;

/// The most bytes one read will hand back, however much was asked for.
///
/// A chunk is buffered whole and, on the desktop transport, base64'd into a
/// single WebSocket frame, so an unbounded request is a way to make the host
/// allocate on a plugin's say-so.
pub const MAX_CHUNK_BYTES: u64 = 8 * 1024 * 1024;

/// What a stored body is, without reading any of it.
#[derive(Debug, Clone, Default)]
pub struct ResponseBodyInfo {
    /// Bytes actually stored, which is not necessarily what `Content-Length`
    /// claimed. Zero when the response has no body.
    pub content_length: u64,
    /// The response's `Content-Type` header, verbatim.
    pub content_type: Option<String>,
    /// Whether the response has finished arriving, so `content_length` is
    /// final. A body still being written grows past it.
    pub complete: bool,
}

/// Somewhere response bodies can be read from, a window at a time.
///
/// Reads are repeatable — the bytes are durable, so nothing is consumed by
/// looking at it.
pub trait ResponseBodyStore {
    fn info(&self, response_id: &str) -> Result<ResponseBodyInfo>;

    /// Bytes `[offset, offset + length)`, clamped to what is there. A short
    /// read means the body ended.
    fn read_chunk(&self, response_id: &str, offset: u64, length: u64) -> Result<Vec<u8>>;
}

/// The desktop and CLI store: the database says where the file is, and the
/// filesystem holds it.
pub struct FileResponseBodyStore<'a> {
    query_manager: &'a QueryManager,
}

impl<'a> FileResponseBodyStore<'a> {
    pub fn new(query_manager: &'a QueryManager) -> Self {
        Self { query_manager }
    }

    /// The file backing a response, or `None` when it stored no body.
    ///
    /// Only responses the store knows about are reachable here. A send with no
    /// request behind it never reaches the store at all, and its bytes come
    /// back from the send instead — see `SendHttpRequestResponse::body`.
    fn body_path(&self, response_id: &str) -> Result<Option<String>> {
        Ok(self.query_manager.connect().get_http_response(response_id)?.body_path)
    }
}

impl ResponseBodyStore for FileResponseBodyStore<'_> {
    fn info(&self, response_id: &str) -> Result<ResponseBodyInfo> {
        let response = self.query_manager.connect().get_http_response(response_id)?;

        let content_type = response
            .headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case("content-type"))
            .map(|h| h.value.clone());

        let content_length = match response.body_path {
            Some(path) => std::fs::metadata(path)?.len(),
            None => 0,
        };

        Ok(ResponseBodyInfo {
            content_length,
            content_type,
            // Closed is the one terminal state: success, error, and cancel all end there.
            complete: matches!(response.state, HttpResponseState::Closed),
        })
    }

    fn read_chunk(&self, response_id: &str, offset: u64, length: u64) -> Result<Vec<u8>> {
        let Some(path) = self.body_path(response_id)? else {
            return Ok(Vec::new());
        };

        let length = length.min(MAX_CHUNK_BYTES);
        if length == 0 {
            return Ok(Vec::new());
        }

        let mut file = File::open(path)?;
        file.seek(SeekFrom::Start(offset))?;

        let mut buf = Vec::new();
        file.take(length).read_to_end(&mut buf)?;
        Ok(buf)
    }
}

/// Discover the next JSONPath level without sending body contents to the UI.
/// Hosts can expose this as RPC/plugin APIs while sharing selection with assertions.
pub fn json_path_children(
    store: &dyn ResponseBodyStore,
    response_id: &str,
    parent: &str,
) -> std::result::Result<yaak_jsonpath::JsonPathChildren, String> {
    yaak_jsonpath::parse(parent)?;
    let info = store.info(response_id).map_err(|e| e.to_string())?;
    if !info.complete {
        return Err("Wait for the response to finish".into());
    }
    if info.content_length > yaak_jsonpath::MAX_BODY_BYTES as u64 {
        return Err("Suggestions are limited to JSON responses up to 10 MiB".into());
    }
    let mut bytes = Vec::new();
    loop {
        let chunk = store
            .read_chunk(
                response_id,
                bytes.len() as u64,
                (yaak_jsonpath::MAX_BODY_BYTES + 1 - bytes.len()) as u64,
            )
            .map_err(|e| e.to_string())?;
        if chunk.is_empty() {
            break;
        }
        bytes.extend_from_slice(&chunk);
        if bytes.len() > yaak_jsonpath::MAX_BODY_BYTES {
            return Err("Suggestions are limited to JSON responses up to 10 MiB".into());
        }
    }
    let document = yaak_jsonpath::parse_body(&bytes)?;
    Ok(yaak_jsonpath::children(&document, parent)?)
}

/// Evaluate the caller's draft against a saved response, without rendering,
/// sending, or writing either the request or its historical assertion results.
pub fn preview_assertions(
    queries: &QueryManager,
    response_id: &str,
    definition: &yaak_assertions::HttpAssertions,
) -> std::result::Result<yaak_assertions::AssertionReport, String> {
    use yaak_assertions::{Body, Completion, MAX_BODY_BYTES, Response};

    let response = queries.connect().get_http_response(response_id).map_err(|e| e.to_string())?;
    if !matches!(response.state, HttpResponseState::Closed) {
        return Err("Wait for the response to finish".into());
    }
    let store = FileResponseBodyStore::new(queries);
    let bytes;
    let mut body = Body::Unavailable;
    if definition.needs_body() && response.error.is_none() {
        // File sizes are only a hint: also cap actual reads, including the
        // overflow byte. A missing/removed body must not prevent status checks.
        let read = || -> Result<Option<Vec<u8>>> {
            if store.info(response_id)?.content_length > MAX_BODY_BYTES as u64 {
                return Ok(None);
            }
            let mut bytes = Vec::new();
            loop {
                let chunk = store.read_chunk(
                    response_id,
                    bytes.len() as u64,
                    (MAX_BODY_BYTES + 1 - bytes.len()) as u64,
                )?;
                if chunk.is_empty() {
                    return Ok(Some(bytes));
                }
                bytes.extend_from_slice(&chunk);
                if bytes.len() > MAX_BODY_BYTES {
                    return Ok(None);
                }
            }
        };
        match read() {
            Ok(None) => body = Body::TooLarge,
            Ok(Some(value)) => {
                bytes = value;
                if !bytes.is_empty() || response.content_length.unwrap_or(0) == 0 {
                    body = Body::Bytes(&bytes);
                }
            }
            Err(_) => {} // The evaluator reports unavailable body checks individually.
        }
    }
    let headers =
        response.headers.iter().map(|h| (h.name.clone(), h.value.clone())).collect::<Vec<_>>();
    Ok(yaak_assertions::evaluate(
        definition,
        Response {
            status: response.status,
            headers: &headers,
            body,
            completion: if response.error.is_some() {
                Completion::Error
            } else {
                Completion::Complete
            },
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;
    use yaak_models::models::{HttpRequest, HttpResponse, HttpResponseHeader, Workspace};
    use yaak_models::util::UpdateSource;

    fn seed(body: Option<&[u8]>) -> (QueryManager, TempDir, String) {
        let temp_dir = TempDir::new().unwrap();
        let (query_manager, blob_manager, _rx) = yaak_models::init_standalone(
            &temp_dir.path().join("db.sqlite"),
            &temp_dir.path().join("blobs.sqlite"),
        )
        .unwrap();

        query_manager
            .with_tx(|tx| {
                tx.upsert_workspace(
                    &Workspace { id: "wk_test".to_string(), ..Default::default() },
                    &UpdateSource::Sync,
                )
            })
            .unwrap();

        query_manager
            .with_tx(|tx| {
                tx.upsert_http_request(
                    &HttpRequest {
                        id: "rq_test".to_string(),
                        workspace_id: "wk_test".to_string(),
                        ..Default::default()
                    },
                    &UpdateSource::Sync,
                )
            })
            .unwrap();

        let body_path = body.map(|bytes| {
            let path = temp_dir.path().join("body");
            let mut f = std::fs::File::create(&path).unwrap();
            f.write_all(bytes).unwrap();
            path.to_string_lossy().to_string()
        });

        let response = query_manager
            .with_tx(|tx| {
                tx.upsert_http_response(
                    &HttpResponse {
                        workspace_id: "wk_test".to_string(),
                        request_id: "rq_test".to_string(),
                        body_path,
                        headers: vec![HttpResponseHeader {
                            name: "Content-Type".to_string(),
                            value: "application/json; charset=utf-8".to_string(),
                        }],
                        ..Default::default()
                    },
                    &UpdateSource::Sync,
                    &blob_manager,
                )
            })
            .unwrap();

        let id = response.id.clone();
        (query_manager, temp_dir, id)
    }

    #[test]
    fn json_discovery_waits_for_completion_and_only_returns_structure() {
        let (qm, _tmp, id) = seed(Some(br#"{"user":{"name":"SECRET","active":true}}"#));
        let store = FileResponseBodyStore::new(&qm);
        assert!(json_path_children(&store, &id, "$").unwrap_err().contains("finish"));
        let mut response = qm.connect().get_http_response(&id).unwrap();
        response.state = HttpResponseState::Closed;
        qm.with_tx(|tx| tx.update_http_response_if_id(&response, &UpdateSource::Sync)).unwrap();
        let children = json_path_children(&store, &id, "$.user").unwrap();
        assert_eq!(children.children.len(), 2);
        assert!(!serde_json::to_string(&children).unwrap().contains("SECRET"));
        assert!(json_path_children(&store, "rs_missing", "$").is_err());
        let path = response.body_path.unwrap();
        std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_len((yaak_jsonpath::MAX_BODY_BYTES + 1) as u64)
            .unwrap();
        assert!(json_path_children(&store, &id, "$").unwrap_err().contains("10 MiB"));
    }

    #[test]
    fn json_discovery_reads_beyond_the_single_chunk_limit() {
        let bytes = serde_json::to_vec(&serde_json::json!({"padding": "a".repeat(MAX_CHUNK_BYTES as usize), "user": {"id": 123}})).unwrap();
        let (qm, _tmp, id) = seed(Some(&bytes));
        let mut response = qm.connect().get_http_response(&id).unwrap();
        response.state = HttpResponseState::Closed;
        qm.with_tx(|tx| tx.update_http_response_if_id(&response, &UpdateSource::Sync)).unwrap();
        let result = json_path_children(&FileResponseBodyStore::new(&qm), &id, "$.user").unwrap();
        assert_eq!(result.children[0].label, "id");
        assert_eq!(result.children[0].kind, "number");
        let mut definition = preview_definition();
        definition.checks.remove(0);
        definition.checks[0].expected = "123".into();
        assert_eq!(preview_assertions(&qm, &id, &definition).unwrap().results[0].outcome, "passed");
    }

    fn preview_definition() -> yaak_assertions::HttpAssertions {
        use yaak_assertions::HttpAssertion;
        yaak_assertions::HttpAssertions {
            checks: vec![
                HttpAssertion {
                    id: "status".into(),
                    target: "status".into(),
                    expected: "200".into(),
                    expected_type: "number".into(),
                    ..Default::default()
                },
                HttpAssertion {
                    id: "body".into(),
                    selector: "$.user.id".into(),
                    expected: "7".into(),
                    expected_type: "number".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn preview_uses_draft_checks_without_changing_saved_models_or_results() {
        let (qm, _tmp, id) = seed(Some(br#"{"user":{"id":7}}"#));
        let mut response = qm.connect().get_http_response(&id).unwrap();
        response.state = HttpResponseState::Closed;
        response.status = 200;
        qm.with_tx(|tx| tx.update_http_response_if_id(&response, &UpdateSource::Sync)).unwrap();
        let mut original = preview_definition();
        original.checks[1].expected = "99".into();
        response.assertion_results = Some(preview_assertions(&qm, &id, &original).unwrap());
        qm.with_tx(|tx| tx.update_http_response_if_id(&response, &UpdateSource::Sync)).unwrap();
        let before_response =
            serde_json::to_value(qm.connect().get_http_response(&id).unwrap()).unwrap();
        let before_request =
            serde_json::to_value(qm.connect().get_http_request("rq_test").unwrap()).unwrap();

        let preview = preview_assertions(&qm, &id, &preview_definition()).unwrap();
        assert!(preview.results.iter().all(|r| r.outcome == "passed"));
        assert_eq!(preview.definition, preview_definition());
        assert_eq!(before_response["assertionResults"]["results"][1]["outcome"], "failed");
        assert_eq!(
            serde_json::to_value(qm.connect().get_http_response(&id).unwrap()).unwrap(),
            before_response
        );
        assert_eq!(
            serde_json::to_value(qm.connect().get_http_request("rq_test").unwrap()).unwrap(),
            before_request
        );
        assert_eq!(std::fs::read(response.body_path.unwrap()).unwrap(), br#"{"user":{"id":7}}"#);
    }

    #[test]
    fn preview_rejects_pending_or_missing_responses_and_never_passes_failed_sends() {
        let (qm, _tmp, id) = seed(Some(br#"{"user":{"id":7}}"#));
        let definition = preview_definition();
        assert!(preview_assertions(&qm, &id, &definition).unwrap_err().contains("finish"));
        assert!(preview_assertions(&qm, "rs_missing", &definition).is_err());
        let mut response = qm.connect().get_http_response(&id).unwrap();
        response.state = HttpResponseState::Closed;
        response.status = 200;
        response.error = Some("Request canceled".into());
        qm.with_tx(|tx| tx.update_http_response_if_id(&response, &UpdateSource::Sync)).unwrap();
        assert!(
            preview_assertions(&qm, &id, &definition)
                .unwrap()
                .results
                .iter()
                .all(|r| r.outcome == "error")
        );
    }

    #[test]
    fn preview_evaluates_status_when_the_saved_body_is_too_large_or_missing() {
        let (qm, _tmp, id) = seed(Some(b""));
        let mut response = qm.connect().get_http_response(&id).unwrap();
        response.state = HttpResponseState::Closed;
        response.status = 200;
        qm.with_tx(|tx| tx.update_http_response_if_id(&response, &UpdateSource::Sync)).unwrap();
        let path = response.body_path.unwrap();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len((yaak_assertions::MAX_BODY_BYTES + 1) as u64)
            .unwrap();
        let preview = preview_assertions(&qm, &id, &preview_definition()).unwrap();
        assert_eq!(preview.results[0].outcome, "passed");
        assert_eq!(preview.results[1].outcome, "error");
        assert!(preview.results[1].reason.contains("10 MiB"));
        std::fs::remove_file(path).unwrap();
        let preview = preview_assertions(&qm, &id, &preview_definition()).unwrap();
        assert_eq!(preview.results[0].outcome, "passed");
        assert_eq!(preview.results[1].outcome, "error");
        assert!(preview.results[1].reason.contains("unavailable"));
    }

    #[test]
    fn info_reports_stored_size_and_content_type() {
        let (qm, _tmp, id) = seed(Some(b"hello world"));
        let info = FileResponseBodyStore::new(&qm).info(&id).unwrap();
        assert_eq!(info.content_length, 11);
        assert_eq!(info.content_type.as_deref(), Some("application/json; charset=utf-8"));
    }

    #[test]
    fn chunks_cover_the_body_and_stop_short_at_the_end() {
        let (qm, _tmp, id) = seed(Some(b"hello world"));
        let store = FileResponseBodyStore::new(&qm);
        assert_eq!(store.read_chunk(&id, 0, 5).unwrap(), b"hello");
        assert_eq!(store.read_chunk(&id, 6, 100).unwrap(), b"world");
        assert!(store.read_chunk(&id, 11, 100).unwrap().is_empty());
        // Reading the same window twice gives the same bytes; nothing is consumed.
        assert_eq!(store.read_chunk(&id, 0, 5).unwrap(), b"hello");
    }

    #[test]
    fn a_response_with_no_body_is_empty_not_an_error() {
        let (qm, _tmp, id) = seed(None);
        let store = FileResponseBodyStore::new(&qm);
        assert_eq!(store.info(&id).unwrap().content_length, 0);
        assert!(store.read_chunk(&id, 0, 100).unwrap().is_empty());
    }

    #[test]
    fn complete_tracks_whether_the_response_has_closed() {
        let (qm, _tmp, id) = seed(Some(b"partial"));
        // Seeded responses default to Initialized: still arriving.
        assert!(!FileResponseBodyStore::new(&qm).info(&id).unwrap().complete);

        let mut response = qm.connect().get_http_response(&id).unwrap();
        response.state = HttpResponseState::Closed;
        qm.with_tx(|tx| tx.update_http_response_if_id(&response, &UpdateSource::Sync)).unwrap();

        assert!(FileResponseBodyStore::new(&qm).info(&id).unwrap().complete);
    }

    #[test]
    fn an_unknown_response_fails() {
        let (qm, _tmp, _id) = seed(Some(b"hi"));
        assert!(FileResponseBodyStore::new(&qm).info("rs_nope").is_err());
    }

    #[test]
    fn an_unsaved_response_is_not_reachable_by_id() {
        // Its bytes rode back with the send; there is nothing here to find, and
        // guessing at a file named for the id is exactly what this must not do.
        let (qm, tmp, _id) = seed(Some(b"hi"));
        std::fs::write(tmp.path().join("rs_ephemeral1"), b"access_token=abc").unwrap();

        assert!(FileResponseBodyStore::new(&qm).info("rs_ephemeral1").is_err());
    }
}
