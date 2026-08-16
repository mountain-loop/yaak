use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error(transparent)]
    Yaak(#[from] yaak::Error),

    #[error(transparent)]
    Model(#[from] yaak_models::error::Error),

    #[error(transparent)]
    Plugin(#[from] yaak_plugins::error::Error),

    #[error(transparent)]
    Crypto(#[from] yaak_crypto::error::Error),

    #[error(transparent)]
    Template(#[from] yaak_templates::error::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Generic(String),
}

pub type Result<T> = std::result::Result<T, Error>;
