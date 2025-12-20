use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Client error: {0:?}")]
    Client(#[from] reqwest::Error),

    #[error(transparent)]
    TlsError(#[from] yaak_tls::error::Error),

    #[error("Request failed with {0:?}")]
    RequestError(String),

    #[error("Request canceled")]
    RequestCanceledError,

    #[error("Timeout of {0:?} reached")]
    RequestTimeout(std::time::Duration),

    #[error("Decompression error: {0}")]
    DecompressionError(String),

    #[error("Failed to read response body: {0}")]
    BodyReadError(String),
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
