use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error(transparent)]
    Send(#[from] crate::send::SendHttpRequestError),
}

pub type Result<T> = std::result::Result<T, Error>;
