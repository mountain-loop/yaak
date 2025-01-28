use thiserror::Error;
use tokio_tungstenite::tungstenite;

#[derive(Error, Debug)]
pub enum Error {
    #[error("WebSocket error: {0}")]
    WebSocketErr(#[from] tungstenite::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
