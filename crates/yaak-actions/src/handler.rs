//! Action handler types and execution.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::{ActionError, ActionParams, ActionResult, CurrentContext};

/// A boxed future for async action handlers.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Function signature for action handlers.
pub type ActionHandlerFn = Arc<
    dyn Fn(CurrentContext, ActionParams) -> BoxFuture<'static, Result<ActionResult, ActionError>>
        + Send
        + Sync,
>;

/// Trait for types that can handle action invocations.
pub trait ActionHandler: Send + Sync {
    /// Execute the action with the given context and parameters.
    fn handle(
        &self,
        context: CurrentContext,
        params: ActionParams,
    ) -> BoxFuture<'static, Result<ActionResult, ActionError>>;
}

/// Wrapper to create an ActionHandler from a function.
pub struct FnHandler<F>(pub F);

impl<F, Fut> ActionHandler for FnHandler<F>
where
    F: Fn(CurrentContext, ActionParams) -> Fut + Send + Sync,
    Fut: Future<Output = Result<ActionResult, ActionError>> + Send + 'static,
{
    fn handle(
        &self,
        context: CurrentContext,
        params: ActionParams,
    ) -> BoxFuture<'static, Result<ActionResult, ActionError>> {
        Box::pin((self.0)(context, params))
    }
}

/// Create an action handler from an async function.
///
/// # Example
/// ```ignore
/// let handler = handler_fn(|ctx, params| async move {
///     Ok(ActionResult::ok())
/// });
/// ```
pub fn handler_fn<F, Fut>(f: F) -> FnHandler<F>
where
    F: Fn(CurrentContext, ActionParams) -> Fut + Send + Sync,
    Fut: Future<Output = Result<ActionResult, ActionError>> + Send + 'static,
{
    FnHandler(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_handler_fn() {
        let handler = handler_fn(|_ctx, _params| async move { Ok(ActionResult::ok()) });

        let result = handler
            .handle(CurrentContext::default(), ActionParams::empty())
            .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handler_with_params() {
        let handler = handler_fn(|_ctx, params| async move {
            let name: Option<String> = params.get("name");
            Ok(ActionResult::with_message(format!(
                "Hello, {}!",
                name.unwrap_or_else(|| "World".to_string())
            )))
        });

        let params = ActionParams::from_json(serde_json::json!({
            "name": "Yaak"
        }));

        let result = handler
            .handle(CurrentContext::default(), params)
            .await
            .unwrap();

        match result {
            ActionResult::Success { message, .. } => {
                assert_eq!(message, Some("Hello, Yaak!".to_string()));
            }
            _ => panic!("Expected Success result"),
        }
    }
}
