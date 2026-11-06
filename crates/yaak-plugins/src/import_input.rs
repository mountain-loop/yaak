use crate::events::{ImportFileSource, ImportRequest};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;

pub const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

impl ImportRequest {
    pub fn from_text(content: &str) -> Self {
        Self { content: content.to_string(), source: None }
    }

    pub fn from_bytes(name: &str, bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() as u64 > MAX_IMPORT_BYTES {
            return Err(io::Error::other("Import file exceeds the 64 MiB limit"));
        }
        Ok(Self {
            content: std::str::from_utf8(bytes).unwrap_or_default().to_string(),
            source: Some(ImportFileSource::File {
                name: name.to_string(),
                base64: STANDARD.encode(bytes),
            }),
        })
    }

    pub fn from_path(path: &Path) -> io::Result<Self> {
        let path = fs::canonicalize(path)?;
        let metadata = fs::metadata(&path)?;
        if metadata.is_dir() {
            return Ok(Self {
                content: String::new(),
                source: Some(ImportFileSource::Directory {
                    path: path
                        .to_str()
                        .ok_or_else(|| io::Error::other("Import path is not UTF-8"))?
                        .to_string(),
                }),
            });
        }
        if !metadata.is_file() {
            return Err(io::Error::other("Import source must be a file or directory"));
        }
        let mut bytes = Vec::new();
        File::open(&path)?.take(MAX_IMPORT_BYTES + 1).read_to_end(&mut bytes)?;
        Self::from_bytes(path.file_name().and_then(|v| v.to_str()).unwrap_or("input"), &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_and_binary_inputs_preserve_bytes() {
        let input = ImportRequest::from_bytes("api.yml", "café".as_bytes()).unwrap();
        assert_eq!(input.content, "café");
        let input = ImportRequest::from_bytes("data.zip", &[0x50, 0x4b, 0xff]).unwrap();
        assert_eq!(input.content, "");
        let Some(ImportFileSource::File { name, base64 }) = input.source else {
            panic!("file input")
        };
        assert_eq!(name, "data.zip");
        assert_eq!(STANDARD.decode(base64).unwrap(), vec![0x50, 0x4b, 0xff]);
        assert!(ImportRequest::from_text("text").source.is_none());
    }

    #[test]
    fn directory_input_is_lazy_and_canonical() {
        let input = ImportRequest::from_path(Path::new(".")).unwrap();
        let Some(ImportFileSource::Directory { path }) = input.source else {
            panic!("directory input")
        };
        assert_eq!(Path::new(&path), fs::canonicalize(".").unwrap());
        assert!(input.content.is_empty());
        assert!(ImportRequest::from_path(Path::new("does-not-exist-yaak-import")).is_err());
    }
}
