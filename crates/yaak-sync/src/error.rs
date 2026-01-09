use serde::{Serialize, Serializer};
use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Yaml error: {0}")]
    YamlParseError(#[from] serde_yaml::Error),

    #[error("Sync parse error: {0}")]
    ParseError(String),

    #[error(transparent)]
    ModelError(#[from] yaak_models::error::Error),

    #[error("Unknown model: {0}")]
    UnknownModel(String),

    #[error("I/o error: {0}")]
    IoError(#[from] io::Error),

    #[error("JSON error: {0}")]
    JsonParseError(#[from] serde_json::Error),

    #[error("Invalid sync file: {0}")]
    InvalidSyncFile(String),

    #[error("Invalid sync directory: {0}")]
    InvalidSyncDirectory(String),

    #[error("Watch error: {0}")]
    NotifyError(#[from] notify::Error),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
