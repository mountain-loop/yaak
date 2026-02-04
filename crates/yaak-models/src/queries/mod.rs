pub mod any_request;
mod batch;
mod cookie_jars;
mod environments;
mod folders;
mod graphql_introspections;
mod grpc_connections;
mod grpc_events;
mod grpc_requests;
mod http_requests;
mod http_response_events;
mod http_responses;
mod key_values;
mod plugin_key_values;
mod plugins;
mod settings;
mod sync_states;
mod websocket_connections;
mod websocket_events;
mod websocket_requests;
mod workspace_metas;
pub mod workspaces;

const MAX_HISTORY_ITEMS: usize = 20;

use crate::models::HttpRequestHeader;
use std::collections::HashMap;

/// Deduplicate headers by name (case-insensitive), keeping the latest (most specific) value.
/// Preserves the order of first occurrence for each header name.
pub(crate) fn dedupe_headers(headers: Vec<HttpRequestHeader>) -> Vec<HttpRequestHeader> {
    let mut index_by_name: HashMap<String, usize> = HashMap::new();
    let mut deduped: Vec<HttpRequestHeader> = Vec::new();
    for header in headers {
        let key = header.name.to_lowercase();
        if let Some(&idx) = index_by_name.get(&key) {
            deduped[idx] = header;
        } else {
            index_by_name.insert(key, deduped.len());
            deduped.push(header);
        }
    }
    deduped
}
