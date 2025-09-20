use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("SQL error: {0}")]
    SqlError(#[from] rusqlite::Error),

    #[error("SQL Pool error: {0}")]
    SqlPoolError(#[from] r2d2::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Model serialization error: {0}")]
    ModelSerializationError(String),

    #[error("Model error: {0}")]
    GenericError(String),

    #[error("DB Migration Failed: {0}")]
    MigrationError(String),

    #[error("No base environment for {0}")]
    MissingBaseEnvironment(String),

    #[error("Multiple base environments for {0}. Delete duplicates before continuing.")]
    MultipleBaseEnvironments(String),
    
    #[error("Multiple folder environments for {0}. Delete duplicates before continuing.")]
    MultipleFolderEnvironments(String),

    #[error("unknown error")]
    Unknown,
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
