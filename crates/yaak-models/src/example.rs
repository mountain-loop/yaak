//! The example workspace offered during onboarding.
//!
//! Authored as JSON with `{{PLACEHOLDER}}` ids so requests can reference each
//! other (the chaining example names another request by id). Every placeholder
//! gets a fresh id per creation, so the example can be created more than once.

use crate::error::Result;
use crate::models::{Environment, Folder, HttpRequest, UpsertModelInfo, Workspace};
use crate::query_manager::QueryManager;
use crate::util::{BatchUpsertResult, UpdateSource};

const EXAMPLE_JSON: &str = include_str!("example_workspace.json");

const WORKSPACE_IDS: &[&str] = &["WORKSPACE"];
const ENVIRONMENT_IDS: &[&str] = &["ENV_BASE", "ENV_USER_2"];
const FOLDER_IDS: &[&str] = &[
    "FOLDER_BASICS",
    "FOLDER_VARIABLES",
    "FOLDER_CHAINING",
    "FOLDER_AUTH",
];
const REQUEST_IDS: &[&str] = &[
    "RQ_LIST_POSTS",
    "RQ_GET_POST",
    "RQ_CREATE_POST",
    "RQ_CURRENT_USER",
    "RQ_LIST_USERS",
    "RQ_POSTS_BY_FIRST_USER",
    "RQ_TODOS",
    "RQ_LOG_IN",
    "RQ_ME",
];

pub fn create_example_workspace(
    query_manager: &QueryManager,
    source: &UpdateSource,
) -> Result<BatchUpsertResult> {
    let resources = example_resources()?;
    Ok(query_manager.with_tx(|tx| {
        tx.batch_upsert(
            resources.workspaces,
            resources.environments,
            resources.folders,
            resources.http_requests,
            resources.grpc_requests,
            resources.websocket_requests,
            source,
        )
    })?)
}

fn example_resources() -> Result<BatchUpsertResult> {
    let mut json = EXAMPLE_JSON.to_string();
    let placeholders = WORKSPACE_IDS
        .iter()
        .map(|p| (*p, Workspace::generate_id()))
        .chain(ENVIRONMENT_IDS.iter().map(|p| (*p, Environment::generate_id())))
        .chain(FOLDER_IDS.iter().map(|p| (*p, Folder::generate_id())))
        .chain(REQUEST_IDS.iter().map(|p| (*p, HttpRequest::generate_id())));
    for (placeholder, id) in placeholders {
        json = json.replace(&format!("{{{{{placeholder}}}}}"), &id);
    }
    debug_assert!(!json.contains("{{"), "example workspace has an unmapped placeholder");
    Ok(serde_json::from_str(&json)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_in_memory;

    #[test]
    fn every_placeholder_is_mapped() {
        let json = serde_json::to_string(&example_resources().unwrap()).unwrap();
        assert!(!json.contains("{{"), "unmapped placeholder in {json}");
    }

    #[test]
    fn chained_request_references_a_created_request() {
        let (query_manager, _blobs, _rx) = init_in_memory().unwrap();
        let created = create_example_workspace(&query_manager, &UpdateSource::Background).unwrap();
        assert_eq!(created.workspaces.len(), 1);
        let workspace_id = &created.workspaces[0].id;

        let db = query_manager.connect();
        let requests = db.list_http_requests(workspace_id).unwrap();
        assert_eq!(requests.len(), REQUEST_IDS.len());
        assert_eq!(db.list_folders(workspace_id).unwrap().len(), FOLDER_IDS.len());
        assert_eq!(db.list_environments(workspace_id).unwrap().len(), ENVIRONMENT_IDS.len());

        let list_users = requests.iter().find(|r| r.name == "List users").unwrap();
        let chained = requests.iter().find(|r| r.name == "Posts by the first user").unwrap();
        let param = &chained.url_parameters[0].value;
        assert!(param.contains(&format!("request='{}'", list_users.id)), "{param}");
    }

    #[test]
    fn creating_twice_makes_two_workspaces() {
        let (query_manager, _blobs, _rx) = init_in_memory().unwrap();
        create_example_workspace(&query_manager, &UpdateSource::Background).unwrap();
        create_example_workspace(&query_manager, &UpdateSource::Background).unwrap();
        assert_eq!(query_manager.connect().list_workspaces().unwrap().len(), 2);
    }
}
