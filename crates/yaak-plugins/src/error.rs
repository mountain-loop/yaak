use crate::events::InternalEvent;
use serde::{Serialize, Serializer};
use thiserror::Error;
use tokio::io;
use tokio::sync::mpsc::error::SendError;

#[derive(Error, Debug)]
pub enum Error {
    #[error(transparent)]
    CryptoErr(#[from] yaak_crypto::error::Error),

    #[error(transparent)]
    DbErr(#[from] yaak_models::error::Error),

    #[error(transparent)]
    TemplateErr(#[from] yaak_templates::error::Error),

    #[error("IO error: {0}")]
    IoErr(#[from] io::Error),

    #[error("Tauri error: {0}")]
    TauriErr(#[from] tauri::Error),

    #[error("Tauri shell error: {0}")]
    TauriShellErr(#[from] tauri_plugin_shell::Error),

    #[error("Grpc send error: {0}")]
    GrpcSendErr(#[from] SendError<InternalEvent>),

    #[error("Failed to send request: {0}")]
    RequestError(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    JsonErr(#[from] serde_json::Error),

    #[error("API Error: {0}")]
    ApiErr(String),

    #[error(transparent)]
    CommonError(#[from] yaak_common::error::Error),

    #[error("Timeout elapsed: {0}")]
    TimeoutElapsed(#[from] tokio::time::error::Elapsed),

    #[error("Plugin not found: {0}")]
    PluginNotFoundErr(String),

    #[error("Auth plugin not found: {0}")]
    AuthPluginNotFound(String),

    #[error("Plugin error: {0}")]
    PluginErr(String),

    #[error("zip error: {0}")]
    ZipError(#[from] zip_extract::ZipExtractError),

    #[error("Client not initialized error")]
    ClientNotInitializedErr,

    #[error("Unknown event received")]
    UnknownEventErr,
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
