use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error(transparent)]
    DbError(#[from] yaak_models::error::Error),

    #[error("Keyring error: {0}")]
    KeyringError(#[from] keyring::Error),

    #[error("No workspace encryption key for {0}")]
    MissingWorkspaceKey(String),

    #[error("Crypto IO error: {0}")]
    IoError(#[from] io::Error),

    #[error("Failed to encrypt")]
    EncryptionError,

    #[error("Failed to decrypt")]
    DecryptionError,

    #[error("Invalid encrypted data")]
    InvalidEncryptedData,

    #[error("Invalid encryption key")]
    InvalidEncryptionKey,

    #[error("Encryption error: {0}")]
    GenericError(String),
}

pub type Result<T> = std::result::Result<T, Error>;
