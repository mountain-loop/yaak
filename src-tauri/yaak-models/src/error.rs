use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("SQL error: {0}")]
    SqlError(#[from] rusqlite::Error),

    #[error("SQL Pool error: {0}")]
    SqlPoolError(#[from] r2d2::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Model not found {0}")]
    ModelNotFound(String),

    #[error("unknown error")]
    Unknown,
}

pub type Result<T> = std::result::Result<T, Error>;
