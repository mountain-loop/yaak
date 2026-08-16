//! Reading response bodies back out, by response id.
//!
//! Plugins only ever name a response. Where its bytes actually live — files the
//! engine wrote under `<data dir>/responses/<id>` today, blob rows later — is
//! behind [`ResponseBodyStore`], so moving the bytes is a change to this file
//! and nothing a plugin can see.

use crate::error::Result;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
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
    response_dir: &'a Path,
}

impl<'a> FileResponseBodyStore<'a> {
    pub fn new(query_manager: &'a QueryManager, response_dir: &'a Path) -> Self {
        Self { query_manager, response_dir }
    }

    /// The file backing a response, or `None` when it stored no body.
    ///
    /// Most responses have a row that names their file. A response sent with no
    /// request behind it — the plugin `ctx.httpRequest.send` of an ad-hoc
    /// request, GraphQL introspection — is ephemeral: the engine gives it an id
    /// and writes its body under that id, but never records it. Those bodies are
    /// still the caller's to read, so fall back to where the engine puts them.
    fn body_path(&self, response_id: &str) -> Result<Option<PathBuf>> {
        match self.query_manager.connect().get_http_response(response_id) {
            Ok(response) => Ok(response.body_path.map(PathBuf::from)),
            Err(err) => match self.ephemeral_path(response_id) {
                Some(path) if path.is_file() => Ok(Some(path)),
                _ => Err(err.into()),
            },
        }
    }

    /// Where an unrecorded response's body would be, if the id can name one.
    ///
    /// Ids arrive from a plugin, so only the shape the engine actually generates
    /// is accepted; that leaves nothing that could climb out of the response
    /// directory.
    fn ephemeral_path(&self, response_id: &str) -> Option<PathBuf> {
        let looks_generated = response_id.starts_with("rs_")
            && response_id.len() > 3
            && response_id[3..].chars().all(|c| c.is_ascii_alphanumeric());

        looks_generated.then(|| self.response_dir.join(response_id))
    }
}

impl ResponseBodyStore for FileResponseBodyStore<'_> {
    fn info(&self, response_id: &str) -> Result<ResponseBodyInfo> {
        // The headers live on the row, so an ephemeral response has none to
        // give. Readers that need its charset have the response object the send
        // handed back.
        let content_type = match self.query_manager.connect().get_http_response(response_id) {
            Ok(response) => response
                .headers
                .iter()
                .find(|h| h.name.eq_ignore_ascii_case("content-type"))
                .map(|h| h.value.clone()),
            Err(_) => None,
        };

        let content_length = match self.body_path(response_id)? {
            Some(path) => std::fs::metadata(path)?.len(),
            None => 0,
        };

        Ok(ResponseBodyInfo { content_length, content_type })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;
    use yaak_models::models::{HttpRequest, HttpResponse, HttpResponseHeader, Workspace};
    use yaak_models::util::UpdateSource;

    fn store<'a>(qm: &'a QueryManager, dir: &'a TempDir) -> FileResponseBodyStore<'a> {
        FileResponseBodyStore::new(qm, dir.path())
    }

    fn seed(body: Option<&[u8]>) -> (QueryManager, TempDir, String) {
        let temp_dir = TempDir::new().unwrap();
        let (query_manager, blob_manager, _rx) = yaak_models::init_standalone(
            &temp_dir.path().join("db.sqlite"),
            &temp_dir.path().join("blobs.sqlite"),
        )
        .unwrap();

        query_manager
            .connect()
            .upsert_workspace(
                &Workspace { id: "wk_test".to_string(), ..Default::default() },
                &UpdateSource::Sync,
            )
            .unwrap();

        query_manager
            .connect()
            .upsert_http_request(
                &HttpRequest {
                    id: "rq_test".to_string(),
                    workspace_id: "wk_test".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )
            .unwrap();

        let body_path = body.map(|bytes| {
            let path = temp_dir.path().join("body");
            let mut f = std::fs::File::create(&path).unwrap();
            f.write_all(bytes).unwrap();
            path.to_string_lossy().to_string()
        });

        let response = query_manager
            .connect()
            .upsert_http_response(
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
            .unwrap();

        let id = response.id.clone();
        (query_manager, temp_dir, id)
    }

    #[test]
    fn info_reports_stored_size_and_content_type() {
        let (qm, _tmp, id) = seed(Some(b"hello world"));
        let info = store(&qm, &_tmp).info(&id).unwrap();
        assert_eq!(info.content_length, 11);
        assert_eq!(info.content_type.as_deref(), Some("application/json; charset=utf-8"));
    }

    #[test]
    fn chunks_cover_the_body_and_stop_short_at_the_end() {
        let (qm, _tmp, id) = seed(Some(b"hello world"));
        let store = store(&qm, &_tmp);
        assert_eq!(store.read_chunk(&id, 0, 5).unwrap(), b"hello");
        assert_eq!(store.read_chunk(&id, 6, 100).unwrap(), b"world");
        assert!(store.read_chunk(&id, 11, 100).unwrap().is_empty());
        // Reading the same window twice gives the same bytes; nothing is consumed.
        assert_eq!(store.read_chunk(&id, 0, 5).unwrap(), b"hello");
    }

    #[test]
    fn a_response_with_no_body_is_empty_not_an_error() {
        let (qm, _tmp, id) = seed(None);
        let store = store(&qm, &_tmp);
        assert_eq!(store.info(&id).unwrap().content_length, 0);
        assert!(store.read_chunk(&id, 0, 100).unwrap().is_empty());
    }

    #[test]
    fn an_unknown_response_fails() {
        let (qm, _tmp, _id) = seed(Some(b"hi"));
        assert!(store(&qm, &_tmp).info("rs_nope").is_err());
    }

    #[test]
    fn an_ephemeral_body_is_readable_by_id_without_a_row() {
        // What a plugin's ad-hoc `ctx.httpRequest.send` leaves behind: a file
        // named for a response the engine never recorded.
        let (qm, tmp, _id) = seed(Some(b"hi"));
        std::fs::write(tmp.path().join("rs_ephemeral1"), b"access_token=abc").unwrap();

        let info = store(&qm, &tmp).info("rs_ephemeral1").unwrap();
        assert_eq!(info.content_length, 16);
        // No row means no headers to report a charset from.
        assert_eq!(info.content_type, None);
        assert_eq!(store(&qm, &tmp).read_chunk("rs_ephemeral1", 0, 6).unwrap(), b"access");
    }

    #[test]
    fn an_id_that_is_not_a_generated_one_cannot_name_a_file() {
        let (qm, tmp, _id) = seed(Some(b"hi"));
        std::fs::write(tmp.path().join("secrets"), b"nope").unwrap();

        for id in ["secrets", "../secrets", "rs_../secrets", "rs_", "/etc/hosts"] {
            assert!(store(&qm, &tmp).info(id).is_err(), "{id} should not resolve");
        }
    }
}
