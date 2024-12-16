use std::collections::BTreeMap;
use std::path::PathBuf;
use std::str::FromStr;

use hyper::client::HttpConnector;
use hyper::Client;
use hyper_rustls::HttpsConnector;
pub use prost_reflect::DynamicMessage;
use prost_reflect::{DescriptorPool, MethodDescriptor, ServiceDescriptor};
use serde_json::Deserializer;
use tauri::AppHandle;
use tokio_stream::wrappers::ReceiverStream;
use tonic::body::BoxBody;
use tonic::metadata::{MetadataKey, MetadataValue};
use tonic::transport::Uri;
use tonic::{IntoRequest, IntoStreamingRequest, Request, Response, Status, Streaming};

use crate::codec::DynamicCodec;
use crate::proto::{
    fill_pool_from_files, fill_pool_from_reflection, get_transport, method_desc_to_path,
};
use crate::{json_schema, MethodDefinition, ServiceDefinition};

#[derive(Clone)]
pub struct GrpcConnection {
    pool: DescriptorPool,
    conn: Client<HttpsConnector<HttpConnector>, BoxBody>,
    pub uri: Uri,
}

#[derive(Default, Debug)]
pub struct StreamError {
    pub message: String,
    pub status: Option<Status>,
}

impl From<String> for StreamError {
    fn from(value: String) -> Self {
        StreamError {
            message: value.to_string(),
            status: None,
        }
    }
}

impl From<Status> for StreamError {
    fn from(s: Status) -> Self {
        StreamError {
            message: s.message().to_string(),
            status: Some(s),
        }
    }
}

impl GrpcConnection {
    pub fn service(&self, service: &str) -> Result<ServiceDescriptor, String> {
        let service = self
            .pool
            .get_service_by_name(service)
            .ok_or("Failed to find service")?;
        Ok(service)
    }

    pub fn method(&self, service: &str, method: &str) -> Result<MethodDescriptor, String> {
        let service = self.service(service)?;
        let method = service
            .methods()
            .find(|m| m.name() == method)
            .ok_or("Failed to find method")?;
        Ok(method)
    }

    pub async fn unary(
        &self,
        service: &str,
        method: &str,
        message: &str,
        metadata: BTreeMap<String, String>,
    ) -> Result<Response<DynamicMessage>, StreamError> {
        let method = &self.method(&service, &method)?;
        let input_message = method.input();

        let mut deserializer = Deserializer::from_str(message);
        let req_message = DynamicMessage::deserialize(input_message, &mut deserializer)
            .map_err(|e| e.to_string())?;
        deserializer.end().unwrap();

        let mut client = tonic::client::Grpc::with_origin(self.conn.clone(), self.uri.clone());

        let mut req = req_message.into_request();
        decorate_req(metadata, &mut req).map_err(|e| e.to_string())?;

        let path = method_desc_to_path(method);
        let codec = DynamicCodec::new(method.clone());
        client.ready().await.unwrap();

        Ok(client.unary(req, path, codec).await?)
    }

    pub async fn streaming(
        &self,
        service: &str,
        method: &str,
        stream: ReceiverStream<DynamicMessage>,
        metadata: BTreeMap<String, String>,
    ) -> Result<Response<Streaming<DynamicMessage>>, StreamError> {
        let method = &self.method(&service, &method)?;
        let mut client = tonic::client::Grpc::with_origin(self.conn.clone(), self.uri.clone());

        let mut req = stream.into_streaming_request();

        decorate_req(metadata, &mut req).map_err(|e| e.to_string())?;

        let path = method_desc_to_path(method);
        let codec = DynamicCodec::new(method.clone());
        client.ready().await.map_err(|e| e.to_string())?;
        Ok(client.streaming(req, path, codec).await?)
    }

    pub async fn client_streaming(
        &self,
        service: &str,
        method: &str,
        stream: ReceiverStream<DynamicMessage>,
        metadata: BTreeMap<String, String>,
    ) -> Result<Response<DynamicMessage>, StreamError> {
        let method = &self.method(&service, &method)?;
        let mut client = tonic::client::Grpc::with_origin(self.conn.clone(), self.uri.clone());
        let mut req = stream.into_streaming_request();
        decorate_req(metadata, &mut req).map_err(|e| e.to_string())?;

        let path = method_desc_to_path(method);
        let codec = DynamicCodec::new(method.clone());
        client.ready().await.unwrap();
        client
            .client_streaming(req, path, codec)
            .await
            .map_err(|e| StreamError {
                message: e.message().to_string(),
                status: Some(e),
            })
    }

    pub async fn server_streaming(
        &self,
        service: &str,
        method: &str,
        message: &str,
        metadata: BTreeMap<String, String>,
    ) -> Result<Response<Streaming<DynamicMessage>>, StreamError> {
        let method = &self.method(&service, &method)?;
        let input_message = method.input();

        let mut deserializer = Deserializer::from_str(message);
        let req_message = DynamicMessage::deserialize(input_message, &mut deserializer)
            .map_err(|e| e.to_string())?;
        deserializer.end().unwrap();

        let mut client = tonic::client::Grpc::with_origin(self.conn.clone(), self.uri.clone());

        let mut req = req_message.into_request();
        decorate_req(metadata, &mut req).map_err(|e| e.to_string())?;

        let path = method_desc_to_path(method);
        let codec = DynamicCodec::new(method.clone());
        client.ready().await.map_err(|e| e.to_string())?;
        Ok(client.server_streaming(req, path, codec).await?)
    }
}

pub struct GrpcHandle {
    app_handle: AppHandle,
    pools: BTreeMap<String, DescriptorPool>,
}

impl GrpcHandle {
    pub fn new(app_handle: &AppHandle) -> Self {
        let pools = BTreeMap::new();
        Self {
            pools,
            app_handle: app_handle.clone(),
        }
    }
}

impl GrpcHandle {
    pub async fn reflect(
        &mut self,
        id: &str,
        uri: &str,
        proto_files: &Vec<PathBuf>,
    ) -> Result<(), String> {
        let pool = if proto_files.is_empty() {
            let full_uri = uri_from_str(uri)?;
            fill_pool_from_reflection(&full_uri).await
        } else {
            fill_pool_from_files(&self.app_handle, proto_files).await
        }?;

        self.pools
            .insert(make_pool_key(id, uri, proto_files), pool.clone());
        Ok(())
    }

    pub async fn services(
        &mut self,
        id: &str,
        uri: &str,
        proto_files: &Vec<PathBuf>,
    ) -> Result<Vec<ServiceDefinition>, String> {
        // Ensure reflection is up-to-date
        self.reflect(id, uri, proto_files).await?;

        let pool = self
            .get_pool(id, uri, proto_files)
            .ok_or("Failed to get pool".to_string())?;
        Ok(self.services_from_pool(&pool))
    }

    fn services_from_pool(&self, pool: &DescriptorPool) -> Vec<ServiceDefinition> {
        pool.services()
            .map(|s| {
                let mut def = ServiceDefinition {
                    name: s.full_name().to_string(),
                    methods: vec![],
                };
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
                            .unwrap(),
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
    ) -> Result<GrpcConnection, String> {
        self.reflect(id, uri, proto_files).await?;
        let pool = self
            .get_pool(id, uri, proto_files)
            .ok_or("Failed to get pool")?;

        let uri = uri_from_str(uri)?;
        let conn = get_transport();
        let connection = GrpcConnection {
            pool: pool.clone(),
            conn,
            uri,
        };
        Ok(connection)
    }

    fn get_pool(&self, id: &str, uri: &str, proto_files: &Vec<PathBuf>) -> Option<&DescriptorPool> {
        self.pools.get(make_pool_key(id, uri, proto_files).as_str())
    }
}

fn decorate_req<T>(metadata: BTreeMap<String, String>, req: &mut Request<T>) -> Result<(), String> {
    for (k, v) in metadata {
        req.metadata_mut().insert(
            MetadataKey::from_str(k.as_str()).map_err(|e| e.to_string())?,
            MetadataValue::from_str(v.as_str()).map_err(|e| e.to_string())?,
        );
    }
    Ok(())
}

fn uri_from_str(uri_str: &str) -> Result<Uri, String> {
    match Uri::from_str(uri_str) {
        Ok(uri) => Ok(uri),
        Err(err) => {
            // Uri::from_str basically only returns "invalid format" so we add more context here
            Err(format!("Failed to parse URL, {}", err.to_string()))
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