use serde::{Serialize, Serializer};
use std::io;
use std::path::PathBuf;
use std::string::FromUtf8Error;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Git repo not found {0}")]
    GitRepoNotFound(PathBuf),

    #[error("Git error: {0}")]
    GitUnknown(#[from] git2::Error),

    #[error("Yaml error: {0}")]
    YamlParseError(#[from] serde_yaml::Error),

    #[error("Yaml error: {0}")]
    ModelError(#[from] yaak_models::error::Error),

    #[error("Sync error: {0}")]
    SyncError(#[from] yaak_sync::error::Error),

    #[error("I/o error: {0}")]
    IoError(#[from] io::Error),

    #[error("Yaml error: {0}")]
    JsonParseError(#[from] serde_json::Error),

    #[error("Yaml error: {0}")]
    Utf8ConversionError(#[from] FromUtf8Error),

    #[error("Git error: {0}")]
    GenericError(String),

    #[error("No default remote found")]
    NoDefaultRemoteFound,

    #[error("Merge failed due to conflicts")]
    MergeConflicts,

    #[error("No active branch")]
    NoActiveBranch,
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
