use crate::error::Result;
use tauri::{command, AppHandle, Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use yaak_crypto::manager::EncryptionManagerExt;
use yaak_plugins::events::PluginWindowContext;
use yaak_plugins::native_template_functions::{decrypt_secure_template_function, encrypt_secure_template_function};

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

#[command]
pub(crate) async fn cmd_decrypt_template<R: Runtime>(
    window: WebviewWindow<R>,
    template: &str,
) -> Result<String> {
    let app_handle = window.app_handle();
    let window_context = &PluginWindowContext::new(&window);
    Ok(decrypt_secure_template_function(&app_handle, window_context, template)?)
}

#[command]
pub(crate) async fn cmd_secure_template<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    template: &str,
) -> Result<String> {
    let window_context = &PluginWindowContext::new(&window);
    Ok(encrypt_secure_template_function(&app_handle, window_context, template)?)
}
