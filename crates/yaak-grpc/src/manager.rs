use crate::codec::DynamicCodec;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::reflection::{
    fill_pool_from_files, fill_pool_from_reflection, method_desc_to_path, reflect_types_for_message,
};
use crate::transport::get_transport;
use crate::{MethodDefinition, ServiceDefinition, json_schema};
use hyper_rustls::HttpsConnector;
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use log::{info, warn};
pub use prost_reflect::DynamicMessage;
use prost_reflect::{DescriptorPool, MethodDescriptor, ServiceDescriptor};
use serde_json::Deserializer;
use std::collections::BTreeMap;
use std::error::Error;
use std::fmt;
use std::fmt::Display;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::ReceiverStream;
use tonic::body::BoxBody;
use tonic::metadata::{MetadataKey, MetadataValue};
use tonic::transport::Uri;
use tonic::{IntoRequest, IntoStreamingRequest, Request, Response, Status, Streaming};
use yaak_tls::ClientCertificateConfig;

#[derive(Clone)]
pub struct GrpcConnection {
    pool: Arc<RwLock<DescriptorPool>>,
    conn: Client<HttpsConnector<HttpConnector>, BoxBody>,
    pub uri: Uri,
    use_reflection: bool,
}

#[derive(Default, Debug)]
pub struct GrpcStreamError {
    pub message: String,
    pub status: Option<Status>,
}

impl Error for GrpcStreamError {}

impl Display for GrpcStreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.status {
            Some(status) => write!(f, "[{}] {}", status, self.message),
            None => write!(f, "{}", self.message),
        }
    }
}

impl From<String> for GrpcStreamError {
    fn from(value: String) -> Self {
        GrpcStreamError { message: value.to_string(), status: None }
    }
}

impl From<Status> for GrpcStreamError {
    fn from(s: Status) -> Self {
        GrpcStreamError { message: s.message().to_string(), status: Some(s) }
    }
}

impl GrpcConnection {
    pub async fn method(&self, service: &str, method: &str) -> Result<MethodDescriptor> {
        let service = self.service(service).await?;
        let method = service
            .methods()
            .find(|m| m.name() == method)
            .ok_or(GenericError("Failed to find method".to_string()))?;
        Ok(method)
    }

    async fn service(&self, service: &str) -> Result<ServiceDescriptor> {
        let pool = self.pool.read().await;
        let service = pool
            .get_service_by_name(service)
            .ok_or(GenericError("Failed to find service".to_string()))?;
        Ok(service)
    }

    pub async fn unary(
        &self,
        service: &str,
        method: &str,
        message: &str,
        metadata: &BTreeMap<String, String>,
        client_cert: Option<ClientCertificateConfig>,
    ) -> Result<Response<DynamicMessage>> {
        if self.use_reflection {
            reflect_types_for_message(self.pool.clone(), &self.uri, message, metadata, client_cert)
                .await?;
        }
        let method = &self.method(&service, &method).await?;
        let input_message = method.input();

        let mut deserializer = Deserializer::from_str(message);
        let req_message = DynamicMessage::deserialize(input_message, &mut deserializer)?;
        deserializer.end()?;

        let mut client = tonic::client::Grpc::with_origin(self.conn.clone(), self.uri.clone());

        let mut req = req_message.into_request();
        decorate_req(metadata, &mut req)?;

        let path = method_desc_to_path(method);
        let codec = DynamicCodec::new(method.clone());
        client.ready().await.map_err(|e| GenericError(format!("Failed to connect: {}", e)))?;

        Ok(client.unary(req, path, codec).await?)
    }

    pub async fn streaming<F>(
        &self,
        service: &str,
        method: &str,
        stream: ReceiverStream<String>,
        metadata: &BTreeMap<String, String>,
        client_cert: Option<ClientCertificateConfig>,
        on_message: F,
    ) -> Result<Response<Streaming<DynamicMessage>>>
    where
        F: Fn(std::result::Result<String, String>) + Send + Sync + Clone + 'static,
    {
        let method = &self.method(&service, &method).await?;
        let mapped_stream = {
            let input_message = method.input();
            let pool = self.pool.clone();
            let uri = self.uri.clone();
            let md = metadata.clone();
            let use_reflection = self.use_reflection.clone();
            let client_cert = client_cert.clone();
            stream
                .then(move |json| {
                    let pool = pool.clone();
                    let uri = uri.clone();
                    let input_message = input_message.clone();
                    let md = md.clone();
                    let use_reflection = use_reflection.clone();
                    let client_cert = client_cert.clone();
                    let on_message = on_message.clone();
                    let json_clone = json.clone();
                    async move {
                        if use_reflection {
                            if let Err(e) =
                                reflect_types_for_message(pool, &uri, &json, &md, client_cert).await
                            {
                                warn!("Failed to resolve Any types: {e}");
                            }
                        }
                        let mut de = Deserializer::from_str(&json);
                        match DynamicMessage::deserialize(input_message, &mut de) {
                            Ok(m) => {
                                on_message(Ok(json_clone));
                                Some(m)
                            }
                            Err(e) => {
                                warn!("Failed to deserialize message: {e}");
                                on_message(Err(e.to_string()));
                                None
                            }
                        }
                    }
                })
                .filter_map(|x| x)
        };

        let mut client = tonic::client::Grpc::with_origin(self.conn.clone(), self.uri.clone());
        let path = method_desc_to_path(method);
        let codec = DynamicCodec::new(method.clone());

        let mut req = mapped_stream.into_streaming_request();
        decorate_req(metadata, &mut req)?;

        client.ready().await.map_err(|e| GenericError(format!("Failed to connect: {}", e)))?;
        Ok(client.streaming(req, path, codec).await?)
    }

    pub async fn client_streaming<F>(
        &self,
        service: &str,
        method: &str,
        stream: ReceiverStream<String>,
        metadata: &BTreeMap<String, String>,
        client_cert: Option<ClientCertificateConfig>,
        on_message: F,
    ) -> Result<Response<DynamicMessage>>
    where
        F: Fn(std::result::Result<String, String>) + Send + Sync + Clone + 'static,
    {
        let method = &self.method(&service, &method).await?;
        let mapped_stream = {
            let input_message = method.input();
            let pool = self.pool.clone();
            let uri = self.uri.clone();
            let md = metadata.clone();
            let use_reflection = self.use_reflection.clone();
            let client_cert = client_cert.clone();
            stream
                .then(move |json| {
                    let pool = pool.clone();
                    let uri = uri.clone();
                    let input_message = input_message.clone();
                    let md = md.clone();
                    let use_reflection = use_reflection.clone();
                    let client_cert = client_cert.clone();
                    let on_message = on_message.clone();
                    let json_clone = json.clone();
                    async move {
                        if use_reflection {
                            if let Err(e) =
                                reflect_types_for_message(pool, &uri, &json, &md, client_cert).await
                            {
                                warn!("Failed to resolve Any types: {e}");
                            }
                        }
                        let mut de = Deserializer::from_str(&json);
                        match DynamicMessage::deserialize(input_message, &mut de) {
                            Ok(m) => {
                                on_message(Ok(json_clone));
                                Some(m)
                            }
                            Err(e) => {
                                warn!("Failed to deserialize message: {e}");
                                on_message(Err(e.to_string()));
                                None
                            }
                        }
                    }
                })
                .filter_map(|x| x)
        };

        let mut client = tonic::client::Grpc::with_origin(self.conn.clone(), self.uri.clone());
        let path = method_desc_to_path(method);
        let codec = DynamicCodec::new(method.clone());

        let mut req = mapped_stream.into_streaming_request();
        decorate_req(metadata, &mut req)?;

        client.ready().await.map_err(|e| GenericError(format!("Failed to connect: {}", e)))?;
        Ok(client
            .client_streaming(req, path, codec)
            .await
            .map_err(|e| GrpcStreamError { message: e.message().to_string(), status: Some(e) })?)
    }

    pub async fn server_streaming(
        &self,
        service: &str,
        method: &str,
        message: &str,
        metadata: &BTreeMap<String, String>,
    ) -> Result<Response<Streaming<DynamicMessage>>> {
        let method = &self.method(&service, &method).await?;
        let input_message = method.input();

        let mut deserializer = Deserializer::from_str(message);
        let req_message = DynamicMessage::deserialize(input_message, &mut deserializer)?;
        deserializer.end()?;

        let mut client = tonic::client::Grpc::with_origin(self.conn.clone(), self.uri.clone());

        let mut req = req_message.into_request();
        decorate_req(metadata, &mut req)?;

        let path = method_desc_to_path(method);
        let codec = DynamicCodec::new(method.clone());
        client.ready().await.map_err(|e| GenericError(format!("Failed to connect: {}", e)))?;
        Ok(client.server_streaming(req, path, codec).await?)
    }
}

/// Configuration for GrpcHandle to compile proto files
#[derive(Clone)]
pub struct GrpcConfig {
    /// Path to the protoc include directory (vendored/protoc/include)
    pub protoc_include_dir: PathBuf,
    /// Path to the yaakprotoc sidecar binary
    pub protoc_bin_path: PathBuf,
}

pub struct GrpcHandle {
    config: GrpcConfig,
    pools: BTreeMap<String, DescriptorPool>,
}

impl GrpcHandle {
    pub fn new(config: GrpcConfig) -> Self {
        let pools = BTreeMap::new();
        Self { pools, config }
    }
}

impl GrpcHandle {
    /// Remove cached descriptor pool for the given key, if present.
    pub fn invalidate_pool(&mut self, id: &str, uri: &str, proto_files: &Vec<PathBuf>) {
        let key = make_pool_key(id, uri, proto_files);
        self.pools.remove(&key);
    }

    pub async fn reflect(
        &mut self,
        id: &str,
        uri: &str,
        proto_files: &Vec<PathBuf>,
        metadata: &BTreeMap<String, String>,
        validate_certificates: bool,
        client_cert: Option<ClientCertificateConfig>,
    ) -> Result<bool> {
        let server_reflection = proto_files.is_empty();
        let key = make_pool_key(id, uri, proto_files);

        // If we already have a pool for this key, reuse it and avoid re-reflection
        if self.pools.contains_key(&key) {
            return Ok(server_reflection);
        }

        let pool = if server_reflection {
            let full_uri = uri_from_str(uri)?;
            fill_pool_from_reflection(&full_uri, metadata, validate_certificates, client_cert).await
        } else {
            fill_pool_from_files(&self.config, proto_files).await
        }?;

        self.pools.insert(key, pool.clone());
        Ok(server_reflection)
    }

    pub async fn services(
        &mut self,
        id: &str,
        uri: &str,
        proto_files: &Vec<PathBuf>,
        metadata: &BTreeMap<String, String>,
        validate_certificates: bool,
        client_cert: Option<ClientCertificateConfig>,
        skip_cache: bool,
    ) -> Result<Vec<ServiceDefinition>> {
        // Ensure we have a pool; reflect only if missing
        if skip_cache || self.get_pool(id, uri, proto_files).is_none() {
            info!("Reflecting gRPC services for {} at {}", id, uri);
            self.reflect(id, uri, proto_files, metadata, validate_certificates, client_cert)
                .await?;
        }

        let pool = self
            .get_pool(id, uri, proto_files)
            .ok_or(GenericError("Failed to get pool".to_string()))?;
        Ok(self.services_from_pool(&pool))
    }

    fn services_from_pool(&self, pool: &DescriptorPool) -> Vec<ServiceDefinition> {
        pool.services()
            .map(|s| {
                let mut def =
                    ServiceDefinition { name: s.full_name().to_string(), methods: vec![] };
                for method in s.methods() {
                    let input_message = method.input();
                    def.methods.push(MethodDefinition {
                        name: method.name().to_string(),
                        server_streaming: method.is_server_streaming(),
                        client_streaming: method.is_client_streaming(),
                        schema: serde_json::to_string_pretty(&json_schema::message_to_json_schema(
                            &pool,
                            input_message,
                        ))
                        .expect("Failed to serialize JSON schema"),
                    })
                }
                def
            })
            .collect::<Vec<_>>()
    }

    pub async fn connect(
        &mut self,
        id: &str,
        uri: &str,
        proto_files: &Vec<PathBuf>,
        metadata: &BTreeMap<String, String>,
        validate_certificates: bool,
        client_cert: Option<ClientCertificateConfig>,
    ) -> Result<GrpcConnection> {
        let use_reflection = proto_files.is_empty();
        if self.get_pool(id, uri, proto_files).is_none() {
            self.reflect(
                id,
                uri,
                proto_files,
                metadata,
                validate_certificates,
                client_cert.clone(),
            )
            .await?;
        }
        let pool = self
            .get_pool(id, uri, proto_files)
            .ok_or(GenericError("Failed to get pool".to_string()))?
            .clone();
        let uri = uri_from_str(uri)?;
        let conn = get_transport(validate_certificates, client_cert.clone())?;
        Ok(GrpcConnection { pool: Arc::new(RwLock::new(pool)), use_reflection, conn, uri })
    }

    fn get_pool(&self, id: &str, uri: &str, proto_files: &Vec<PathBuf>) -> Option<&DescriptorPool> {
        self.pools.get(make_pool_key(id, uri, proto_files).as_str())
    }
}

pub(crate) fn decorate_req<T>(
    metadata: &BTreeMap<String, String>,
    req: &mut Request<T>,
) -> Result<()> {
    for (k, v) in metadata {
        req.metadata_mut()
            .insert(MetadataKey::from_str(k.as_str())?, MetadataValue::from_str(v.as_str())?);
    }
    Ok(())
}

fn uri_from_str(uri_str: &str) -> Result<Uri> {
    match Uri::from_str(uri_str) {
        Ok(uri) => Ok(uri),
        Err(err) => {
            // Uri::from_str basically only returns "invalid format" so we add more context here
            Err(GenericError(format!("Failed to parse URL, {}", err.to_string())))
        }
    }
}

fn make_pool_key(id: &str, uri: &str, proto_files: &Vec<PathBuf>) -> String {
    let pool_key = format!(
        "{}::{}::{}",
        id,
        uri,
        proto_files
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<String>>()
            .join(":")
    );

    format!("{:x}", md5::compute(pool_key))
}
