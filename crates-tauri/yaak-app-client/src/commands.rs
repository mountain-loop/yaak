use crate::PluginContextExt;
use crate::error::Result;
use tauri::{Runtime, State, WebviewWindow};
use yaak_plugins::events::GetThemesResponse;
use yaak_plugins::manager::PluginManager;

pub(crate) async fn cmd_get_themes<R: Runtime>(
    window: WebviewWindow<R>,
    plugin_manager: State<'_, PluginManager>,
) -> Result<Vec<GetThemesResponse>> {
    Ok(plugin_manager.get_themes(&window.plugin_context()).await?)
}
