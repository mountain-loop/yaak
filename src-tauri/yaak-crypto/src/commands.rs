use crate::error::Result;
use crate::manager::EncryptionManagerExt;
use crate::workspace_key::WorkspaceKey;
use tauri::{command, Runtime, WebviewWindow};

#[command]
pub(crate) async fn enable_encryption<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    window.crypto().ensure_workspace_key(workspace_id)?;
    window.crypto().reveal_workspace_key(workspace_id)?;
    Ok(())
}

#[command]
pub(crate) async fn reveal_workspace_key<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> Result<String> {
    Ok(window.crypto().reveal_workspace_key(workspace_id)?)
}

#[command]
pub(crate) async fn set_workspace_key<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
    key: &str,
) -> Result<()> {
    let wkey = WorkspaceKey::from_human(workspace_id, key)?;
    window.crypto().set_workspace_key(workspace_id, &wkey)?;
    Ok(())
}
