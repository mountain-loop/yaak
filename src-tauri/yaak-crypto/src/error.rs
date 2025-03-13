use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Keyring error: {0}")]
    KeyringError(#[from] keyring::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
