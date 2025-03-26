use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Keyring error: {0}")]
    KeyringError(#[from] keyring::Error),

    #[error("Crypto IO error: {0}")]
    IoError(#[from] io::Error),

    #[error("DB error: {0}")]
    DbError(#[from] yaak_models::error::Error),

    #[error("Encryption error: {0}")]
    AesGcmError(#[from] aes_gcm::Error),

    #[error("No workspace encryption key for {0}")]
    MissingWorkspaceKey(String),

    #[error("Invalid encrypted data")]
    InvalidEncryptedData,

    #[error("Invalid encryption key")]
    InvalidEncryptionKey,

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Encryption error: {0}")]
    GenericError(String),
}

pub type Result<T> = std::result::Result<T, Error>;
