use crate::error::Result;
use tauri::{command, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use yaak_crypto::manager::EncryptionManagerExt;

#[command]
pub(crate) async fn cmd_encrypt_input<R: Runtime>(
    _window: WebviewWindow<R>,
    _environment_id: Option<&str>,
) -> Result<String> {
    let result = "".to_string();
    Ok(result)
}

#[command]
pub(crate) async fn cmd_decrypt_input<R: Runtime>(
    _window: WebviewWindow<R>,
    _environment_id: Option<&str>,
) -> Result<String> {
    let result = "".to_string();
    Ok(result)
}

#[command]
pub(crate) async fn cmd_show_workspace_key<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    let key = window.crypto().reveal_workspace_key(workspace_id)?;
    window
        .dialog()
        .message(format!("Your workspace key is \n\n{}", key))
        .kind(MessageDialogKind::Info)
        .show(|_v| {});
    Ok(())
}
