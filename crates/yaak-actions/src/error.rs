//! Error types for the action system.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::{ActionGroupId, ActionId};

/// Errors that can occur during action operations.
#[derive(Debug, Error, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ActionError {
    /// Action not found in registry.
    #[error("Action not found: {0}")]
    NotFound(ActionId),

    /// Action is disabled in current context.
    #[error("Action is disabled: {action_id} - {reason}")]
    Disabled { action_id: ActionId, reason: String },

    /// Invalid scope for the action.
    #[error("Invalid scope: expected {expected:?}, got {actual:?}")]
    InvalidScope {
        expected: crate::ActionScope,
        actual: crate::ActionScope,
    },

    /// Action execution timed out.
    #[error("Action timed out: {0}")]
    Timeout(ActionId),

    /// Error from plugin execution.
    #[error("Plugin error: {0}")]
    PluginError(String),

    /// Validation error in action parameters.
    #[error("Validation error: {0}")]
    ValidationError(String),

    /// Permission denied for action.
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    /// Action was cancelled by user.
    #[error("Action cancelled by user")]
    Cancelled,

    /// Internal error.
    #[error("Internal error: {0}")]
    Internal(String),

    /// Required context is missing.
    #[error("Required context missing: {missing_fields:?}")]
    ContextMissing {
        /// The context fields that are missing.
        missing_fields: Vec<String>,
    },

    /// Action group not found.
    #[error("Group not found: {0}")]
    GroupNotFound(ActionGroupId),

    /// Action group already exists.
    #[error("Group already exists: {0}")]
    GroupAlreadyExists(ActionGroupId),
}

impl ActionError {
    /// Get a user-friendly error message.
    pub fn user_message(&self) -> String {
        match self {
            Self::NotFound(id) => format!("Action '{}' is not available", id),
            Self::Disabled { reason, .. } => reason.clone(),
            Self::InvalidScope { expected, actual } => {
                format!("Action requires {:?} scope, but got {:?}", expected, actual)
            }
            Self::Timeout(_) => "The operation took too long and was cancelled".into(),
            Self::PluginError(msg) => format!("Plugin error: {}", msg),
            Self::ValidationError(msg) => format!("Invalid input: {}", msg),
            Self::PermissionDenied(resource) => format!("Permission denied for {}", resource),
            Self::Cancelled => "Operation was cancelled".into(),
            Self::Internal(_) => "An unexpected error occurred".into(),
            Self::ContextMissing { missing_fields } => {
                format!("Missing required context: {}", missing_fields.join(", "))
            }
            Self::GroupNotFound(id) => format!("Action group '{}' not found", id),
            Self::GroupAlreadyExists(id) => format!("Action group '{}' already exists", id),
        }
    }

    /// Whether this error should be reported to telemetry.
    pub fn is_reportable(&self) -> bool {
        matches!(self, Self::Internal(_) | Self::PluginError(_))
    }

    /// Whether this error can potentially be resolved by user interaction.
    pub fn is_promptable(&self) -> bool {
        matches!(self, Self::ContextMissing { .. })
    }

    /// Whether this is a user-initiated cancellation.
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Self::Cancelled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_messages() {
        let err = ActionError::ContextMissing {
            missing_fields: vec!["workspace".into()],
        };
        assert_eq!(err.user_message(), "Missing required context: workspace");
        assert!(err.is_promptable());
        assert!(!err.is_cancelled());

        let cancelled = ActionError::Cancelled;
        assert!(cancelled.is_cancelled());
        assert!(!cancelled.is_promptable());

        let not_found = ActionError::NotFound(ActionId::builtin("test", "action"));
        assert_eq!(
            not_found.user_message(),
            "Action 'yaak:test:action' is not available"
        );
    }
}
