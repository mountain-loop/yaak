use crate::error::Result;

#[tauri::command]
pub(crate) fn upsert() -> Result<String> {
    Ok("".to_string())
}

#[tauri::command]
pub(crate) fn delete() -> Result<()> {
    Ok(())
}
