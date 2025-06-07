use crate::manager::decorate_req;
use crate::transport::get_transport;
use async_recursion::async_recursion;
use hyper_rustls::HttpsConnector;
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use log::debug;
use std::collections::BTreeMap;
use tokio_stream::StreamExt;
use tonic::Request;
use tonic::body::BoxBody;
use tonic::transport::Uri;
use tonic_reflection::pb::v1::server_reflection_request::MessageRequest;
use tonic_reflection::pb::v1::server_reflection_response::MessageResponse;
use tonic_reflection::pb::v1::{
    ErrorResponse, ExtensionNumberResponse, ListServiceResponse, ServerReflectionRequest,
    ServiceResponse,
};
use tonic_reflection::pb::v1::{ExtensionRequest, FileDescriptorResponse};
use tonic_reflection::pb::{v1, v1alpha};

pub struct AutoReflectionClient<T = Client<HttpsConnector<HttpConnector>, BoxBody>> {
    use_v1alpha: bool,
    client_v1: v1::server_reflection_client::ServerReflectionClient<T>,
    client_v1alpha: v1alpha::server_reflection_client::ServerReflectionClient<T>,
}

impl AutoReflectionClient {
    pub fn new(uri: &Uri, validate_certificates: bool) -> Self {
        let client_v1 = v1::server_reflection_client::ServerReflectionClient::with_origin(
            get_transport(validate_certificates),
            uri.clone(),
        );
        let client_v1alpha = v1alpha::server_reflection_client::ServerReflectionClient::with_origin(
            get_transport(validate_certificates),
            uri.clone(),
        );
        AutoReflectionClient {
            use_v1alpha: false,
            client_v1,
            client_v1alpha,
        }
    }

    #[async_recursion]
    pub async fn send_reflection_request(
        &mut self,
        message: MessageRequest,
        metadata: &BTreeMap<String, String>,
    ) -> Result<MessageResponse, String> {
        let reflection_request = ServerReflectionRequest {
            host: "".into(), // Doesn't matter
            message_request: Some(message.clone()),
        };

        if self.use_v1alpha {
            let mut request = Request::new(tokio_stream::once(to_v1alpha_request(reflection_request)));
            decorate_req(metadata, &mut request).map_err(|e| e.to_string())?;

            self.client_v1alpha
                .server_reflection_info(request)
                .await
                .map_err(|e| match e.code() {
                    tonic::Code::Unavailable => "Failed to connect to endpoint".to_string(),
                    tonic::Code::Unauthenticated => "Authentication failed".to_string(),
                    tonic::Code::DeadlineExceeded => "Deadline exceeded".to_string(),
                    _ => e.to_string(),
                })?
                .into_inner()
                .next()
                .await
                .expect("steamed response")
                .map_err(|e| e.to_string())?
                .message_response
                .ok_or("No reflection response".to_string())
                .map(|resp| to_v1_msg_response(resp))
        } else {
            let mut request = Request::new(tokio_stream::once(reflection_request));
            decorate_req(metadata, &mut request).map_err(|e| e.to_string())?;

            let resp = self.client_v1.server_reflection_info(request).await;
            match resp {
                Ok(r) => Ok(r),
                Err(e) => match e.code().clone() {
                    tonic::Code::Unimplemented => {
                        // If v1 fails, change to v1alpha and try again
                        debug!("gRPC schema reflection falling back to v1alpha");
                        self.use_v1alpha = true;
                        return self.send_reflection_request(message, metadata).await;
                    }
                    _ => Err(e),
                },
            }
            .map_err(|e| match e.code() {
                tonic::Code::Unavailable => "Failed to connect to endpoint".to_string(),
                tonic::Code::Unauthenticated => "Authentication failed".to_string(),
                tonic::Code::DeadlineExceeded => "Deadline exceeded".to_string(),
                _ => e.to_string(),
            })?
            .into_inner()
            .next()
            .await
            .expect("steamed response")
            .map_err(|e| e.to_string())?
            .message_response
            .ok_or("No reflection response".to_string())
        }
    }
}

fn to_v1_msg_response(
    response: v1alpha::server_reflection_response::MessageResponse,
) -> MessageResponse {
    match response {
        v1alpha::server_reflection_response::MessageResponse::FileDescriptorResponse(v) => {
            MessageResponse::FileDescriptorResponse(FileDescriptorResponse {
                file_descriptor_proto: v.file_descriptor_proto,
            })
        }
        v1alpha::server_reflection_response::MessageResponse::AllExtensionNumbersResponse(v) => {
            MessageResponse::AllExtensionNumbersResponse(ExtensionNumberResponse {
                extension_number: v.extension_number,
                base_type_name: v.base_type_name,
            })
        }
        v1alpha::server_reflection_response::MessageResponse::ListServicesResponse(v) => {
            MessageResponse::ListServicesResponse(ListServiceResponse {
                service: v
                    .service
                    .iter()
                    .map(|s| ServiceResponse {
                        name: s.name.clone(),
                    })
                    .collect(),
            })
        }
        v1alpha::server_reflection_response::MessageResponse::ErrorResponse(v) => {
            MessageResponse::ErrorResponse(ErrorResponse {
                error_code: v.error_code,
                error_message: v.error_message,
            })
        }
    }
}

fn to_v1alpha_request(request: ServerReflectionRequest) -> v1alpha::ServerReflectionRequest {
    v1alpha::ServerReflectionRequest {
        host: request.host,
        message_request: request.message_request.map(|m| to_v1alpha_msg_request(m)),
    }
}

fn to_v1alpha_msg_request(
    message: MessageRequest,
) -> v1alpha::server_reflection_request::MessageRequest {
    match message {
        MessageRequest::FileByFilename(v) => {
            v1alpha::server_reflection_request::MessageRequest::FileByFilename(v)
        }
        MessageRequest::FileContainingSymbol(v) => {
            v1alpha::server_reflection_request::MessageRequest::FileContainingSymbol(v)
        }
        MessageRequest::FileContainingExtension(ExtensionRequest {
            extension_number,
            containing_type,
        }) => v1alpha::server_reflection_request::MessageRequest::FileContainingExtension(
            v1alpha::ExtensionRequest {
                extension_number,
                containing_type,
            },
        ),
        MessageRequest::AllExtensionNumbersOfType(v) => {
            v1alpha::server_reflection_request::MessageRequest::AllExtensionNumbersOfType(v)
        }
        MessageRequest::ListServices(v) => {
            v1alpha::server_reflection_request::MessageRequest::ListServices(v)
        }
    }
}
