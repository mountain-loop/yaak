use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error(transparent)]
    ReqwestError(#[from] reqwest::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
