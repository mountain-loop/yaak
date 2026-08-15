//! Where response bodies live, from a response id alone.
//!
//! [`send`](crate::send) writes each body to `<response dir>/<response id>`,
//! and every reader has to find it again knowing only the id: commands take an
//! id from the client and never a path, so a path the client chose can never be
//! opened. [`is_response_id`] is the check that makes joining a client-supplied
//! id onto the response directory safe.

use std::path::{Path, PathBuf};

/// The file a response's body is written to, and therefore read back from.
pub fn response_body_path(response_dir: &Path, response_id: &str) -> PathBuf {
    response_dir.join(response_id)
}

/// Whether a string is shaped like a response id, and can therefore be joined
/// onto the response directory without escaping it.
///
/// Ids are `rs_<hex>`. Rejecting anything else outright, rather than trying to
/// sanitize it, is what keeps "read the body of response X" from naming a file
/// of the caller's choosing: no separators, no `..`, no absolute paths, no
/// drive letters, no NUL.
pub fn is_response_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_generated_ids() {
        assert!(is_response_id("rs_A1b2C3d4"));
        assert!(is_response_id("rs_with-dash"));
    }

    #[test]
    fn rejects_anything_that_could_escape_the_directory() {
        for id in [
            "",
            "..",
            "../../etc/passwd",
            "rs_1/../../secret",
            "/etc/passwd",
            r"C:\Windows\System32",
            r"rs_1\..\secret",
            "rs_1.txt",
            "rs_1\0",
        ] {
            assert!(!is_response_id(id), "{id:?} should be rejected");
        }
    }
}
