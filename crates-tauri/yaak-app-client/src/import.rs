use crate::PluginContextExt;
use crate::error::{Error, Result};
use crate::models_ext::QueryManagerExt;
use std::fs::read_to_string;
use std::io::ErrorKind;
use tauri::{Manager, Runtime, WebviewWindow};
use yaak::import::{self, PlanImportDataParams};
use yaak_api::{ApiClientKind, yaak_api_client};
use yaak_models::util::{BatchUpsertResult, ImportDestination, ImportPlan};
use yaak_plugins::manager::PluginManager;

pub(crate) async fn import_data<R: Runtime>(
    window: &WebviewWindow<R>,
    file_path: &str,
) -> Result<BatchUpsertResult> {
    let plan = plan_import_data(window, file_path, ImportDestination::NewWorkspace).await?;
    commit_import(window, plan)
}

pub(crate) async fn plan_import_data<R: Runtime>(
    window: &WebviewWindow<R>,
    file_path: &str,
    destination: ImportDestination,
) -> Result<ImportPlan> {
    let contents = read_import_file(file_path)?;
    plan_import_contents(window, &contents, destination).await
}

pub(crate) async fn plan_import_url<R: Runtime>(
    window: &WebviewWindow<R>,
    url: &str,
    destination: ImportDestination,
) -> Result<ImportPlan> {
    let contents = fetch_import_url(window, url).await?;
    plan_import_contents(window, &contents, destination).await
}

async fn plan_import_contents<R: Runtime>(
    window: &WebviewWindow<R>,
    contents: &str,
    destination: ImportDestination,
) -> Result<ImportPlan> {
    let plugin_manager = window.state::<PluginManager>();
    let query_manager = window.db_manager();
    let plugin_context = window.plugin_context();

    Ok(import::plan_import_data(PlanImportDataParams {
        query_manager: &query_manager,
        plugin_manager: &plugin_manager,
        plugin_context: &plugin_context,
        destination,
        contents,
    })
    .await?)
}

pub(crate) fn commit_import<R: Runtime>(
    window: &WebviewWindow<R>,
    plan: ImportPlan,
) -> Result<BatchUpsertResult> {
    Ok(import::commit_import_plan(&window.db_manager(), plan)?)
}

/// Download an importable document (OpenAPI, Postman, Insomnia, …) so it can be fed to the same
/// pipeline as a file on disk.
///
/// This uses Yaak's own API client, which follows the OS proxy but not the workspace's proxy,
/// client certificate, or certificate-validation settings. Requests are unauthenticated, so
/// specs behind auth must still be downloaded manually and imported as a file.
async fn fetch_import_url<R: Runtime>(window: &WebviewWindow<R>, url: &str) -> Result<String> {
    let url = normalize_import_url(url)?;
    let app_version = window.app_handle().package_info().version.to_string();
    let response = yaak_api_client(ApiClientKind::App, &app_version)?
        .get(&url)
        // The API client defaults to JSON, but specs are just as often YAML
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|err| Error::GenericError(format!("Failed to fetch {url}: {err}")))?;

    let status = response.status();
    if !status.is_success() {
        return Err(Error::GenericError(format!("Failed to fetch {url}: responded with {status}")));
    }

    response
        .text()
        .await
        .map_err(|err| Error::GenericError(format!("Failed to read response from {url}: {err}")))
}

fn normalize_import_url(url: &str) -> Result<String> {
    let url = url.trim();
    if url.is_empty() {
        return Err(Error::GenericError("Import URL must not be empty".to_string()));
    }

    if url.starts_with("http://") || url.starts_with("https://") {
        return Ok(url.to_string());
    }

    match url.split_once("://") {
        Some((scheme, _)) => {
            Err(Error::GenericError(format!("Import URL must be http or https, but got {scheme}")))
        }
        None => Ok(format!("https://{url}")),
    }
}

fn read_import_file(file_path: &str) -> Result<String> {
    read_to_string(file_path).map_err(|err| {
        if err.kind() == ErrorKind::InvalidData {
            Error::GenericError(format!(
                "Import file must be UTF-8 text; binary files are not supported: {file_path}"
            ))
        } else {
            Error::GenericError(format!("Unable to read import file {file_path}: {err}"))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{remove_file, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn read_import_file_returns_error_for_binary_file() {
        let path = std::env::temp_dir().join(format!(
            "yaak-import-binary-{}.pftrace",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before unix epoch")
                .as_nanos()
        ));
        write(&path, [0xff, 0xfe, 0xfd]).expect("write binary fixture");

        let err = read_import_file(path.to_str().expect("temp path is utf-8"))
            .expect_err("binary import should return an error");

        assert!(err.to_string().contains("binary files are not supported"));

        remove_file(path).expect("remove binary fixture");
    }

    #[test]
    fn normalize_import_url_defaults_to_https() {
        assert_eq!(
            normalize_import_url(" example.com/openapi.yaml ").unwrap(),
            "https://example.com/openapi.yaml"
        );
        assert_eq!(
            normalize_import_url("http://example.com/openapi.yaml").unwrap(),
            "http://example.com/openapi.yaml"
        );
    }

    #[test]
    fn normalize_import_url_rejects_other_schemes() {
        assert!(normalize_import_url("file:///tmp/openapi.yaml").is_err());
        assert!(normalize_import_url("  ").is_err());
    }
}
