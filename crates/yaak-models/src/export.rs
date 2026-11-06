//! Building an export document.
//!
//! Here rather than in `yaak` because the whole of it is this crate: a connection, the
//! resources, and JSON. Putting it where the browser can reach it too is what keeps a
//! tab's export from being a second implementation that drifts.

use crate::error::Result;
use crate::query_manager::QueryManager;
use crate::util::get_workspace_export_resources;

pub struct ExportDataParams<'a> {
    pub query_manager: &'a QueryManager,
    pub yaak_version: &'a str,
    pub workspace_ids: Vec<&'a str>,
    pub include_private_environments: bool,
}

/// The export document, as JSON.
///
/// Returned rather than written: where an export goes is the host's to decide, and a browser
/// tab has no path to be handed. The desktop hands the bytes to its save dialog, the CLI
/// writes them, a tab downloads them. None of that is this function's business.
pub fn export_data(params: ExportDataParams<'_>) -> Result<String> {
    let db = params.query_manager.connect();
    let export_data = get_workspace_export_resources(
        &db,
        params.yaak_version,
        params.workspace_ids,
        params.include_private_environments,
    )?;

    Ok(serde_json::to_string_pretty(&export_data)?)
}
