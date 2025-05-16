use serde::{Serialize, Serializer};
use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error(transparent)]
    DbError(#[from] yaak_models::error::Error),

    #[error("Keyring error: {0}")]
    KeyringError(#[from] keyring::Error),

    #[error("Missing workspace encryption key")]
    MissingWorkspaceKey,

    #[error("Incorrect workspace key")]
    IncorrectWorkspaceKey,

    #[error("Failed to decrypt workspace key: {0}")]
    WorkspaceKeyDecryptionError(String),

    #[error("Crypto IO error: {0}")]
    IoError(#[from] io::Error),

    #[error("Failed to encrypt data")]
    EncryptionError,

    #[error("Failed to decrypt data")]
    DecryptionError,

    #[error("Invalid encrypted data")]
    InvalidEncryptedData,

    #[error("Invalid key provided")]
    InvalidHumanKey,

    #[error("Encryption error: {0}")]
    GenericError(String),
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
