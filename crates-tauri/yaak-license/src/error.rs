use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Reqwest error: {0}")]
    APIError(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("{message}")]
    ClientError { message: String, error: String },

    #[error(transparent)]
    ModelError(#[from] yaak_models::error::Error),

    #[error(transparent)]
    CommonError(#[from] yaak_common::error::Error),

    #[error("Internal server error")]
    ServerError,
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
