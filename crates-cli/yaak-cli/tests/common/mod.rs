#![allow(dead_code)]

pub mod http_server;

use assert_cmd::Command;
use assert_cmd::cargo::cargo_bin_cmd;
use std::path::Path;
use yaak_models::models::{HttpRequest, Workspace};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;

pub fn cli_cmd(data_dir: &Path) -> Command {
    let mut cmd = cargo_bin_cmd!("yaakcli");
    cmd.arg("--data-dir").arg(data_dir);
    cmd
}

pub fn parse_created_id(stdout: &[u8], label: &str) -> String {
    String::from_utf8_lossy(stdout)
        .trim()
        .split_once(": ")
        .map(|(_, id)| id.to_string())
        .unwrap_or_else(|| panic!("Expected id in '{label}' output"))
}

pub fn query_manager(data_dir: &Path) -> QueryManager {
    let db_path = data_dir.join("db.sqlite");
    let blob_path = data_dir.join("blobs.sqlite");
    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize DB");
    query_manager
}

pub fn seed_workspace(data_dir: &Path, workspace_id: &str) {
    let workspace = Workspace {
        id: workspace_id.to_string(),
        name: "Seed Workspace".to_string(),
        description: "Seeded for integration tests".to_string(),
        ..Default::default()
    };

    query_manager(data_dir)
        .connect()
        .upsert_workspace(&workspace, &UpdateSource::Sync)
        .expect("Failed to seed workspace");
}

pub fn seed_request(data_dir: &Path, workspace_id: &str, request_id: &str) {
    let request = HttpRequest {
        id: request_id.to_string(),
        workspace_id: workspace_id.to_string(),
        name: "Seeded Request".to_string(),
        method: "GET".to_string(),
        url: "https://example.com".to_string(),
        ..Default::default()
    };

    query_manager(data_dir)
        .connect()
        .upsert_http_request(&request, &UpdateSource::Sync)
        .expect("Failed to seed request");
}
