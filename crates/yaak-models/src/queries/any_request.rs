use crate::client_db::ClientDb;
use crate::error::Result;
use crate::models::{GrpcRequest, HttpRequest, WebsocketRequest};
use serde_json::Value;

pub enum AnyRequest {
    HttpRequest(HttpRequest),
    GrpcRequest(GrpcRequest),
    WebsocketRequest(WebsocketRequest),
}

/// Run an expression against whichever request this is, bound as `$request`.
macro_rules! with_request {
    ($self:expr, |$request:ident| $body:expr) => {
        match $self {
            AnyRequest::HttpRequest($request) => $body,
            AnyRequest::GrpcRequest($request) => $body,
            AnyRequest::WebsocketRequest($request) => $body,
        }
    };
}

impl AnyRequest {
    pub fn id(&self) -> &str {
        with_request!(self, |request| &request.id)
    }

    pub fn workspace_id(&self) -> &str {
        with_request!(self, |request| &request.workspace_id)
    }

    /// The model name, eg. `http_request`.
    pub fn model_type(&self) -> &str {
        with_request!(self, |request| &request.model)
    }

    pub fn to_value(&self) -> Result<Value> {
        Ok(with_request!(self, |request| serde_json::to_value(request)?))
    }
}

impl<'a> ClientDb<'a> {
    pub fn get_any_request(&self, id: &str) -> Result<AnyRequest> {
        if let Ok(http_request) = self.get_http_request(id) {
            Ok(AnyRequest::HttpRequest(http_request))
        } else if let Ok(grpc_request) = self.get_grpc_request(id) {
            Ok(AnyRequest::GrpcRequest(grpc_request))
        } else {
            Ok(AnyRequest::WebsocketRequest(self.get_websocket_request(id)?))
        }
    }
}
