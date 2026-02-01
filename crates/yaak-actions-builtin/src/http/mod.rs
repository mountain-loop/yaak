//! HTTP action implementations.

pub mod send;

use crate::BuiltinActionDependencies;
use yaak_actions::{ActionError, ActionExecutor, ActionSource};

/// Register all HTTP-related actions with the executor.
pub async fn register_http_actions(
    executor: &ActionExecutor,
    deps: &BuiltinActionDependencies,
) -> Result<(), ActionError> {
    let handler = send::HttpSendActionHandler {
        query_manager: deps.query_manager.clone(),
        plugin_manager: deps.plugin_manager.clone(),
        encryption_manager: deps.encryption_manager.clone(),
    };

    executor
        .register(send::metadata(), ActionSource::Builtin, handler)
        .await?;

    Ok(())
}
