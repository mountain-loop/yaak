use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Keyring error: {0}")]
    KeyringError(#[from] keyring::Error),

    #[error("Decrypt error: {0}")]
    DecryptError(#[from] age::DecryptError),

    #[error("Encrypt error: {0}")]
    EncryptError(#[from] age::EncryptError),

    #[error("Crypto IO error: {0}")]
    IoError(#[from] io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
