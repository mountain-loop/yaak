use crate::PluginContextExt;
use crate::error::{Error, Result};
use crate::models_ext::QueryManagerExt;
use std::fs::read_to_string;
use std::io::ErrorKind;
use tauri::{Manager, Runtime, WebviewWindow};
use yaak::import::{self, ImportDataParams};
use yaak_core::WorkspaceContext;
use yaak_models::util::BatchUpsertResult;
use yaak_plugins::manager::PluginManager;
use yaak_tauri_utils::window::WorkspaceWindowTrait;

pub(crate) async fn import_data<R: Runtime>(
    window: &WebviewWindow<R>,
    file_path: &str,
) -> Result<BatchUpsertResult> {
    let plugin_manager = window.state::<PluginManager>();
    let query_manager = window.db_manager();
    let file = read_import_file(file_path)?;
    let plugin_context = window.plugin_context();
    let workspace_context = WorkspaceContext {
        workspace_id: window.workspace_id(),
        environment_id: window.environment_id(),
        cookie_jar_id: window.cookie_jar_id(),
        request_id: None,
    };

    Ok(import::import_data(ImportDataParams {
        query_manager: &query_manager,
        plugin_manager: &plugin_manager,
        plugin_context: &plugin_context,
        workspace_context,
        contents: &file,
    })
    .await?)
}

fn read_import_file(file_path: &str) -> Result<String> {
    read_to_string(file_path).map_err(|err| {
        if err.kind() == ErrorKind::InvalidData {
            Error::GenericError(format!(
                "Import file must be UTF-8 text; binary files are not supported: {file_path}"
            ))
        } else {
            Error::GenericError(format!("Unable to read import file {file_path}: {err}"))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{remove_file, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn read_import_file_returns_error_for_binary_file() {
        let path = std::env::temp_dir().join(format!(
            "yaak-import-binary-{}.pftrace",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before unix epoch")
                .as_nanos()
        ));
        write(&path, [0xff, 0xfe, 0xfd]).expect("write binary fixture");

        let err = read_import_file(path.to_str().expect("temp path is utf-8"))
            .expect_err("binary import should return an error");

        assert!(err.to_string().contains("binary files are not supported"));

        remove_file(path).expect("remove binary fixture");
    }
}
