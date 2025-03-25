use crate::error::Result;
use crate::models::AnyModel;
use tauri::{Runtime, WebviewWindow};

#[tauri::command]
pub(crate) async fn upsert<R: Runtime>(
    _window: WebviewWindow<R>,
    _model: AnyModel,
) -> Result<String> {
    todo!();
}

#[tauri::command]
pub(crate) fn delete() -> Result<()> {
    Ok(())
}
