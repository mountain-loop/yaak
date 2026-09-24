use crate::PluginContextExt;
use crate::error::{Error, Result};
use crate::models_ext::QueryManagerExt;
use std::path::Path;
use tauri::{Manager, Runtime, WebviewWindow};
use yaak::import::{self, PlanImportDataParams};
use yaak_api::{ApiClientKind, yaak_api_client};
use yaak_models::util::{BatchUpsertResult, ImportDestination, ImportOrigin, ImportPlan};
use yaak_plugins::events::ImportRequest;

pub(crate) async fn import_data<R: Runtime>(
    window: &WebviewWindow<R>,
    file_path: &str,
    origin: Option<ImportOrigin>,
) -> Result<BatchUpsertResult> {
    let input = read_import_file(file_path)?;
    let plan =
        plan_import_contents(window, &input, ImportDestination::NewWorkspace, origin).await?;
    commit_import(window, plan)
}

pub(crate) async fn plan_import_data<R: Runtime>(
    window: &WebviewWindow<R>,
    file_paths: &[String],
    urls: &[String],
    destination: ImportDestination,
) -> Result<ImportPlan> {
    let plugin_manager = crate::plugins_ext::plugin_manager(window).await?;
    let plugin_context = window.plugin_context();
    let mut seen = std::collections::BTreeSet::new();
    let mut inputs = Vec::new();
    for path in file_paths {
        let origin = file_origin(path);
        if !seen.insert(origin.origin.clone()) {
            continue;
        }
        let input = read_import_file(path)?;
        let response = plugin_manager
            .import_input(&plugin_context, &input)
            .await
            .map_err(|err| Error::GenericError(format!("Unable to import {path}: {err}")))?;
        inputs.push((response, origin));
    }
    for url in urls {
        let url = normalize_import_url(url)?;
        if !seen.insert(url.clone()) {
            continue;
        }
        let input = fetch_import_url(window, &url).await?;
        let response = plugin_manager
            .import_input(&plugin_context, &input)
            .await
            .map_err(|err| Error::GenericError(format!("Unable to import {url}: {err}")))?;
        inputs.push((response, url_origin(&url)));
    }
    Ok(import::plan_import_batch_resources(&window.db_manager(), destination, inputs)?)
}

/// Which importer claims a source, without planning it. Backs the per-source status in the
/// import dialog so unsupported files are flagged before preview.
pub(crate) async fn detect_import_source<R: Runtime>(
    window: &WebviewWindow<R>,
    file_path: Option<String>,
    url: Option<String>,
) -> Result<String> {
    let input = match (file_path, url) {
        (Some(path), _) => read_import_file(&path)?,
        (None, Some(url)) => fetch_import_url(window, &normalize_import_url(&url)?).await?,
        (None, None) => return Err(Error::GenericError("Nothing to detect".into())),
    };
    let plugin_manager = crate::plugins_ext::plugin_manager(window).await?;
    let response = plugin_manager.import_input(&window.plugin_context(), &input).await.map_err(
        |err| match err {
            yaak_plugins::error::Error::PluginErr(msg) if msg.starts_with("No importers found") => {
                Error::GenericError("Not a supported format".into())
            }
            err => Error::GenericError(err.to_string()),
        },
    )?;
    Ok(response.importer)
}

pub(crate) async fn plan_import_url<R: Runtime>(
    window: &WebviewWindow<R>,
    url: &str,
    destination: ImportDestination,
) -> Result<ImportPlan> {
    let url = normalize_import_url(url)?;
    let input = fetch_import_url(window, &url).await?;
    plan_import_contents(window, &input, destination, Some(url_origin(&url))).await
}

async fn plan_import_contents<R: Runtime>(
    window: &WebviewWindow<R>,
    input: &ImportRequest,
    destination: ImportDestination,
    origin: Option<ImportOrigin>,
) -> Result<ImportPlan> {
    let plugin_manager = crate::plugins_ext::plugin_manager(window).await?;
    let query_manager = window.db_manager();
    let plugin_context = window.plugin_context();

    Ok(import::plan_import_data(PlanImportDataParams {
        query_manager: &query_manager,
        plugin_manager: &plugin_manager,
        plugin_context: &plugin_context,
        destination,
        input,
        origin,
    })
    .await?)
}

/// Canonicalize so re-importing the same file through a different spelling of its path still
/// matches the linked source.
pub(crate) fn file_origin(file_path: &str) -> ImportOrigin {
    let path = std::path::Path::new(file_path);
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let label = canonical
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string());
    ImportOrigin { origin: canonical.to_string_lossy().to_string(), label }
}

pub(crate) fn url_origin(url: &str) -> ImportOrigin {
    ImportOrigin { origin: url.to_string(), label: url.to_string() }
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
async fn fetch_import_url<R: Runtime>(
    window: &WebviewWindow<R>,
    url: &str,
) -> Result<ImportRequest> {
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

    // Apply the same input-size limit to downloads before allocating the whole body.
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| Error::GenericError(format!("Failed to read response from {url}: {err}")))?
    {
        if bytes.len() + chunk.len() > 64 * 1024 * 1024 {
            return Err(Error::GenericError("Import file exceeds the 64 MiB limit".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    let name = reqwest::Url::parse(&url)
        .ok()
        .and_then(|url| {
            url.path_segments().and_then(|mut segments| segments.next_back().map(str::to_owned))
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "download".into());
    ImportRequest::from_bytes(&name, &bytes).map_err(|err| Error::GenericError(err.to_string()))
}

pub(crate) fn normalize_import_url(url: &str) -> Result<String> {
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

fn read_import_file(file_path: &str) -> Result<ImportRequest> {
    ImportRequest::from_path(Path::new(file_path)).map_err(|err| {
        Error::GenericError(format!("Unable to read import source {file_path}: {err}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{remove_file, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn read_import_file_accepts_binary_file() {
        let path = std::env::temp_dir().join(format!(
            "yaak-import-binary-{}.pftrace",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before unix epoch")
                .as_nanos()
        ));
        write(&path, [0xff, 0xfe, 0xfd]).expect("write binary fixture");

        let input = read_import_file(path.to_str().expect("temp path is utf-8"))
            .expect("binary import should preserve bytes");

        assert!(input.source.is_some());
        assert!(input.content.is_empty());

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
