use crate::error::Result;
use crate::manager::QueryManagerExt;
use crate::models::AnyModel;
use crate::queries_legacy::UpdateSource;
use tauri::{Runtime, WebviewWindow};

#[tauri::command]
pub(crate) async fn upsert<R: Runtime>(
    window: WebviewWindow<R>,
    model: AnyModel,
) -> Result<String> {
    todo!();
}

#[tauri::command]
pub(crate) fn delete() -> Result<()> {
    Ok(())
}
