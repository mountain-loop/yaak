pub mod any_request;
mod batch;
mod cookie_jars;
mod duplicate_name;
mod environments;
mod folders;
mod graphql_introspections;
mod grpc_connections;
mod grpc_events;
mod grpc_requests;
mod http_requests;
mod http_response_events;
mod http_responses;
mod import_source_resources;
mod import_sources;
mod key_values;
mod model_changes;
mod plugin_key_values;
mod plugins;
mod settings;
mod sync_states;
mod websocket_connections;
mod websocket_events;
mod websocket_requests;
mod workspace_metas;
pub mod workspaces;
pub use model_changes::PersistedModelChange;
pub(crate) use duplicate_name::conflict_free_name;

const MAX_HISTORY_ITEMS: usize = 20;

use crate::models::HttpRequestHeader;
use std::collections::HashSet;

/// Merge a more-specific header layer over its parent. Names in the child replace
/// inherited values case-insensitively, while duplicates declared together in
/// either layer remain independent entries.
pub(crate) fn merge_headers(
    mut parent: Vec<HttpRequestHeader>,
    child: Vec<HttpRequestHeader>,
) -> Vec<HttpRequestHeader> {
    let child_names = child.iter().map(|header| header.name.to_lowercase()).collect::<HashSet<_>>();
    parent.retain(|header| !child_names.contains(&header.name.to_lowercase()));
    parent.extend(child);
    parent
}

#[cfg(test)]
mod tests {
    use super::merge_headers;
    use crate::models::HttpRequestHeader;

    fn header(name: &str, value: &str) -> HttpRequestHeader {
        HttpRequestHeader { name: name.to_string(), value: value.to_string(), ..Default::default() }
    }

    #[test]
    fn preserves_duplicate_headers_declared_in_one_layer() {
        let merged = merge_headers(
            vec![header("Cookie", "inherited=1")],
            vec![
                header("Cookie", "required=1"),
                header("cookie", "optional=1"),
            ],
        );

        assert_eq!(
            merged.iter().map(|header| header.value.as_str()).collect::<Vec<_>>(),
            vec!["required=1", "optional=1"],
        );
    }

    #[test]
    fn child_names_override_parent_names_without_affecting_other_headers() {
        let merged = merge_headers(
            vec![header("Accept", "*/*"), header("X-Parent", "kept")],
            vec![header("accept", "application/json")],
        );

        assert_eq!(
            merged
                .iter()
                .map(|header| (header.name.as_str(), header.value.as_str()))
                .collect::<Vec<_>>(),
            vec![("X-Parent", "kept"), ("accept", "application/json")],
        );
    }
}
