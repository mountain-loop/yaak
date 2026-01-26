use crate::PluginContextExt;
use crate::error::Result;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow, command};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use yaak_crypto::manager::EncryptionManager;
use yaak_models::models::HttpRequestHeader;
use yaak_models::queries::workspaces::default_headers;
use yaak_plugins::events::GetThemesResponse;
use yaak_plugins::manager::PluginManager;
use yaak_plugins::native_template_functions::{
    decrypt_secure_template_function, encrypt_secure_template_function,
};

/// Extension trait for accessing the EncryptionManager from Tauri Manager types.
pub trait EncryptionManagerExt<'a, R> {
    fn crypto(&'a self) -> State<'a, EncryptionManager>;
}

impl<'a, R: Runtime, M: Manager<R>> EncryptionManagerExt<'a, R> for M {
    fn crypto(&'a self) -> State<'a, EncryptionManager> {
        self.state::<EncryptionManager>()
    }
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

#[command]
pub(crate) async fn cmd_decrypt_template<R: Runtime>(
    window: WebviewWindow<R>,
    template: &str,
) -> Result<String> {
    let encryption_manager = window.app_handle().state::<EncryptionManager>();
    let plugin_context = window.plugin_context();
    Ok(decrypt_secure_template_function(&encryption_manager, &plugin_context, template)?)
}

#[command]
pub(crate) async fn cmd_secure_template<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    template: &str,
) -> Result<String> {
    let plugin_manager = Arc::new((*app_handle.state::<PluginManager>()).clone());
    let encryption_manager = Arc::new((*app_handle.state::<EncryptionManager>()).clone());
    let plugin_context = window.plugin_context();
    Ok(encrypt_secure_template_function(
        plugin_manager,
        encryption_manager,
        &plugin_context,
        template,
    )?)
}

#[command]
pub(crate) async fn cmd_get_themes<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> Result<Vec<GetThemesResponse>> {
    Ok(plugin_manager.get_themes(&window.plugin_context()).await?)
}

#[command]
pub(crate) async fn cmd_enable_encryption<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    window.crypto().ensure_workspace_key(workspace_id)?;
    window.crypto().reveal_workspace_key(workspace_id)?;
    Ok(())
}

#[command]
pub(crate) async fn cmd_reveal_workspace_key<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> Result<String> {
    Ok(window.crypto().reveal_workspace_key(workspace_id)?)
}

#[command]
pub(crate) async fn cmd_set_workspace_key<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
    key: &str,
) -> Result<()> {
    window.crypto().set_human_key(workspace_id, key)?;
    Ok(())
}

#[command]
pub(crate) async fn cmd_disable_encryption<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    window.crypto().disable_encryption(workspace_id)?;
    Ok(())
}

#[command]
pub(crate) fn cmd_default_headers() -> Vec<HttpRequestHeader> {
    default_headers()
}
