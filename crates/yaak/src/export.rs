use crate::Result;
use std::fs::File;
use std::path::Path;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::get_workspace_export_resources;

pub struct ExportDataParams<'a> {
    pub query_manager: &'a QueryManager,
    pub yaak_version: &'a str,
    pub export_path: &'a Path,
    pub workspace_ids: Vec<&'a str>,
    pub include_private_environments: bool,
}

pub fn export_data(params: ExportDataParams<'_>) -> Result<()> {
    let db = params.query_manager.connect();
    let export_data = get_workspace_export_resources(
        &db,
        params.yaak_version,
        params.workspace_ids,
        params.include_private_environments,
    )?;

    let file = File::options().create(true).truncate(true).write(true).open(params.export_path)?;
    serde_json::to_writer_pretty(&file, &export_data)?;
    file.sync_all()?;

    Ok(())
}
