use std::collections::BTreeMap;

use crate::error::Result;
use KeyAndValueRef::{Ascii, Binary};
use tauri::{Manager, Runtime, WebviewWindow};
use yaak_grpc::{KeyAndValueRef, MetadataMap};
use yaak_models::models::GrpcRequest;
use yaak_models::query_manager::QueryManagerExt;
use yaak_plugins::events::{CallHttpAuthenticationRequest, HttpHeader};
use yaak_plugins::manager::PluginManager;

pub(crate) fn metadata_to_map(metadata: MetadataMap) -> BTreeMap<String, String> {
    let mut entries = BTreeMap::new();
    for r in metadata.iter() {
        match r {
            Ascii(k, v) => entries.insert(k.to_string(), v.to_str().unwrap().to_string()),
            Binary(k, v) => entries.insert(k.to_string(), format!("{:?}", v)),
        };
    }
    entries
}

pub(crate) fn resolve_grpc_request<R: Runtime>(
    window: &WebviewWindow<R>,
    request: &GrpcRequest,
) -> Result<(GrpcRequest, String)> {
    let mut new_request = request.clone();

    let (authentication_type, authentication, authentication_context_id) =
        window.db().resolve_auth_for_grpc_request(request)?;
    new_request.authentication_type = authentication_type;
    new_request.authentication = authentication;

    let metadata = window.db().resolve_metadata_for_grpc_request(request)?;
    new_request.metadata = metadata;

    Ok((new_request, authentication_context_id))
}

pub(crate) async fn build_metadata<R: Runtime>(
    window: &WebviewWindow<R>,
    request: &GrpcRequest,
    authentication_context_id: &str,
) -> Result<BTreeMap<String, String>> {
    let plugin_manager = window.state::<PluginManager>();
    let mut metadata = BTreeMap::new();

    // Add the rest of metadata
    for h in request.metadata.clone() {
        if h.name.is_empty() && h.value.is_empty() {
            continue;
        }

        if !h.enabled {
            continue;
        }

        metadata.insert(h.name, h.value);
    }

    match request.authentication_type.clone() {
        None => {
            // No authentication found. Not even inherited
        }
        Some(authentication_type) if authentication_type == "none" => {
            // Explicitly no authentication
        }
        Some(authentication_type) => {
            let auth = request.authentication.clone();
            let plugin_req = CallHttpAuthenticationRequest {
                context_id: format!("{:x}", md5::compute(authentication_context_id)),
                values: serde_json::from_value(serde_json::to_value(&auth).unwrap()).unwrap(),
                method: "POST".to_string(),
                url: request.url.clone(),
                headers: metadata
                    .iter()
                    .map(|(name, value)| HttpHeader {
                        name: name.to_string(),
                        value: value.to_string(),
                    })
                    .collect(),
            };
            let plugin_result = plugin_manager
                .call_http_authentication(&window, &authentication_type, plugin_req)
                .await?;
            for header in plugin_result.set_headers {
                metadata.insert(header.name, header.value);
            }
        }
    }

    Ok(metadata)
}
