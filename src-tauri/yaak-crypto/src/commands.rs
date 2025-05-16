use crate::error::Result;
use crate::manager::EncryptionManagerExt;
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
    window.crypto().set_human_key(workspace_id, key)?;
    Ok(())
}
