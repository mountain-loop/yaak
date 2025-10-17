use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{
    GrpcRequest, HttpRequest, WebsocketRequest,
};

pub enum AnyRequest {
    HttpRequest(HttpRequest),
    GrpcRequest(GrpcRequest),
    WebsocketRequest(WebsocketRequest),
}

impl<'a> DbContext<'a> {
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
