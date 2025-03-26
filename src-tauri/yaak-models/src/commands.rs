use crate::error::Result;
use crate::query_manager::QueryManagerExt;
use crate::models::AnyModel;
use crate::util::UpdateSource;
use tauri::{Runtime, WebviewWindow};

#[tauri::command]
pub(crate) async fn upsert<R: Runtime>(
    window: WebviewWindow<R>,
    model: AnyModel,
) -> Result<String> {
    let id = match model {
        AnyModel::HttpRequest(r) => window.db().upsert(&r, &UpdateSource::from_window(&window))?.id,
        _ => todo!(),
    };

    Ok(id)
}

#[tauri::command]
pub(crate) fn delete() -> Result<()> {
    Ok(())
}
