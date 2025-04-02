use serde::{Serialize, Serializer};
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

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
