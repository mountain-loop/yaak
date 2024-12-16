use crate::error::Result;
use crate::sync::sync_fs;
use log::error;
use tauri::{command, Runtime, WebviewWindow};

#[command]
pub async fn sync<R: Runtime>(window: WebviewWindow<R>, workspace_id: &str) -> Result<()> {
    match sync_fs(&window, workspace_id).await {
        Ok(_) => Ok(()),
        Err(e) => {
            error!("Failed to sync {e:?}");
            Err(e)
        }
    }
}
