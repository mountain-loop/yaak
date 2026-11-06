//! Export and formatting.

use crate::error::Result;
use crate::host::Host;
use yaak_models::example::create_example_workspace;
use yaak_models::export::{self, ExportDataParams};
use yaak_models::util::BatchUpsertResult;
use yaak_rpc_schema::*;
use yaak_templates::format_json::format_json;

pub async fn cmd_export_data<H: Host>(host: H, req: CmdExportDataReq) -> Result<String> {
    let version = host.app_version();
    Ok(export::export_data(ExportDataParams {
        query_manager: host.query_manager(),
        yaak_version: &version,
        workspace_ids: req.workspace_ids.iter().map(|s| s.as_str()).collect(),
        include_private_environments: req.include_private_environments,
    })?)
}

pub async fn cmd_create_example_workspace<H: Host>(
    host: H,
    _req: CmdCreateExampleWorkspaceReq,
) -> Result<BatchUpsertResult> {
    Ok(create_example_workspace(host.query_manager(), &host.update_source())?)
}

pub async fn cmd_format_json<H: Host>(_host: H, req: CmdFormatJsonReq) -> Result<String> {
    Ok(format_json(&req.text, "  "))
}
