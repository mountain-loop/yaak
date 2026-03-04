use crate::context::CliContext;

pub fn resolve_workspace_id(
    ctx: &CliContext,
    workspace_id: Option<&str>,
    command_name: &str,
) -> Result<String, String> {
    if let Some(workspace_id) = workspace_id {
        return Ok(workspace_id.to_string());
    }

    let workspaces =
        ctx.db().list_workspaces().map_err(|e| format!("Failed to list workspaces: {e}"))?;
    match workspaces.as_slice() {
        [] => Err(format!("No workspaces found. {command_name} requires a workspace ID.")),
        [workspace] => Ok(workspace.id.clone()),
        _ => Err(format!("Multiple workspaces found. {command_name} requires a workspace ID.")),
    }
}
