use crate::error::Result;
use crate::manager::EncryptionManagerExt;
use tauri::{command, Runtime, WebviewWindow};

#[command]
pub(crate) async fn enable_encryption<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> Result<String> {
    window.crypto().ensure_workspace_key(workspace_id)?;
    Ok(window.crypto().reveal_workspace_key(workspace_id)?)
}
