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
    let queries = window.queries().connect().await?;
    let id = match model {
        AnyModel::HttpRequest(r) => queries.upsert(&r, &UpdateSource::from_window(&window))?.id,
        _ => todo!(),
    };

    Ok(id)
}

#[tauri::command]
pub(crate) fn delete() -> Result<()> {
    Ok(())
}
