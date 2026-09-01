use std::collections::BTreeMap;

use crate::PluginContextExt;
use crate::error::Result;
use KeyAndValueRef::{Ascii, Binary};
use tauri::{Runtime, WebviewWindow};
use yaak_grpc::{KeyAndValueRef, MetadataMap};
use yaak_models::models::GrpcRequest;
use yaak_plugins::events::{CallHttpAuthenticationRequest, HttpHeader};

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


pub(crate) async fn build_metadata<R: Runtime>(
    window: &WebviewWindow<R>,
    request: &GrpcRequest,
    authentication_context_id: &str,
) -> Result<BTreeMap<String, String>> {
    let plugin_manager = crate::plugins_ext::plugin_manager(window).await?;
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
                values: serde_json::from_value(serde_json::to_value(&auth)?)?,
                method: "POST".to_string(),
                url: request.url.clone(),
                headers: metadata
                    .iter()
                    .map(|(name, value)| HttpHeader {
                        name: name.to_string(),
                        value: value.to_string(),
                    })
                    .collect(),
                body: None,
            };
            let plugin_result = plugin_manager
                .call_http_authentication(
                    &window.plugin_context(),
                    &authentication_type,
                    plugin_req,
                )
                .await?;
            for header in plugin_result.set_headers.unwrap_or_default() {
                metadata.insert(header.name, header.value);
            }
        }
    }

    Ok(metadata)
}
