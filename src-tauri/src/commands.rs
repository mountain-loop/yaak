use tauri::{command, Runtime, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tokio::sync::Mutex;
use yaak_crypto::manager::EncryptionManager;
use crate::error::Result;

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
    _encryption_manager: State<'_, Mutex<EncryptionManager>>,
) -> Result<String> {
    let result = "".to_string();
    Ok(result)
}

#[command]
pub(crate) async fn cmd_show_workspace_key<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
    encryption_manager: State<'_, Mutex<EncryptionManager>>,
) -> Result<()> {
    let mgr = &*encryption_manager.lock().await;
    let key = mgr.reveal_workspace_key(workspace_id).await?;
    window
        .dialog()
        .message(format!("Your workspace key is \n\n{}", key))
        .kind(MessageDialogKind::Info)
        .show(|_v| {});
    Ok(())
}
