use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum Error {
    #[error("Render Error: {0}")]
    RenderError(String),

    #[error("Render Error: Variable \"{0}\" is not defined in active environment")]
    VariableNotFound(String),

    #[error("Render Error: Max recursion depth exceeded")]
    RenderStackExceededError,
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
