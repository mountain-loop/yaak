use crate::manager::GrpcStreamError;
use prost::DecodeError;
use serde::{Serialize, Serializer};
use serde_json::Error as SerdeJsonError;
use std::io;
use thiserror::Error;
use tonic::Status;

#[derive(Error, Debug)]
pub enum Error {
    #[error(transparent)]
    TlsError(#[from] yaak_tls::error::Error),

    #[error(transparent)]
    TonicError(#[from] Status),

    #[error("Prost reflect error: {0:?}")]
    ProstReflectError(#[from] prost_reflect::DescriptorError),

    #[error(transparent)]
    DeserializerError(#[from] SerdeJsonError),

    #[error(transparent)]
    GrpcStreamError(#[from] GrpcStreamError),

    #[error(transparent)]
    GrpcDecodeError(#[from] DecodeError),

    #[error(transparent)]
    GrpcInvalidMetadataKeyError(#[from] tonic::metadata::errors::InvalidMetadataKey),

    #[error(transparent)]
    GrpcInvalidMetadataValueError(#[from] tonic::metadata::errors::InvalidMetadataValue),

    #[error(transparent)]
    IOError(#[from] io::Error),

    #[error("GRPC error: {0}")]
    GenericError(String),
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
