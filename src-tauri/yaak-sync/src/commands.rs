use crate::error::Result;
use crate::sync::{apply_sync, calculate_sync, SyncOp};
use tauri::{command, Runtime, WebviewWindow};

#[command]
pub async fn apply<R: Runtime>(window: WebviewWindow<R>, workspace_id: &str) -> Result<()> {
    apply_sync(&window, workspace_id).await
}

#[command]
pub async fn calculate<R: Runtime>(window: WebviewWindow<R>, workspace_id: &str) -> Result<Vec<SyncOp>> {
    calculate_sync(&window, workspace_id).await
}
