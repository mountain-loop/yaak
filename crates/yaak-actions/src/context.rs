//! Action context types and context-aware filtering.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ActionScope;

/// Specifies what context fields an action requires.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RequiredContext {
    /// Action requires a workspace to be active.
    #[serde(default)]
    pub workspace: ContextRequirement,

    /// Action requires an environment to be selected.
    #[serde(default)]
    pub environment: ContextRequirement,

    /// Action requires a specific target entity (request, folder, etc.).
    #[serde(default)]
    pub target: ContextRequirement,

    /// Action requires a window context (for UI operations).
    #[serde(default)]
    pub window: ContextRequirement,
}

impl RequiredContext {
    /// Action requires a target entity.
    pub fn requires_target() -> Self {
        Self {
            target: ContextRequirement::Required,
            ..Default::default()
        }
    }

    /// Action requires workspace and target.
    pub fn requires_workspace_and_target() -> Self {
        Self {
            workspace: ContextRequirement::Required,
            target: ContextRequirement::Required,
            ..Default::default()
        }
    }

    /// Action works globally, no specific context needed.
    pub fn global() -> Self {
        Self::default()
    }

    /// Action requires target with prompt if missing.
    pub fn requires_target_with_prompt() -> Self {
        Self {
            target: ContextRequirement::RequiredWithPrompt,
            ..Default::default()
        }
    }

    /// Action requires environment with prompt if missing.
    pub fn requires_environment_with_prompt() -> Self {
        Self {
            environment: ContextRequirement::RequiredWithPrompt,
            ..Default::default()
        }
    }
}

/// How strictly a context field is required.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum ContextRequirement {
    /// Field is not needed.
    #[default]
    NotRequired,

    /// Field is optional but will be used if available.
    Optional,

    /// Field must be present; action will fail without it.
    Required,

    /// Field must be present; prompt user to select if missing.
    RequiredWithPrompt,
}

/// Current context state from the application.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CurrentContext {
    /// Current workspace ID (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,

    /// Current environment ID (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment_id: Option<String>,

    /// Currently selected target (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<ActionTarget>,

    /// Whether a window context is available.
    #[serde(default)]
    pub has_window: bool,

    /// Whether the context provider can prompt for missing fields.
    #[serde(default)]
    pub can_prompt: bool,
}

/// The target entity for an action.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ActionTarget {
    /// No target.
    None,
    /// HTTP request target.
    HttpRequest { id: String },
    /// WebSocket request target.
    WebsocketRequest { id: String },
    /// gRPC request target.
    GrpcRequest { id: String },
    /// Workspace target.
    Workspace { id: String },
    /// Folder target.
    Folder { id: String },
    /// Environment target.
    Environment { id: String },
    /// Multiple targets.
    Multiple { targets: Vec<ActionTarget> },
}

impl ActionTarget {
    /// Get the scope this target corresponds to.
    pub fn scope(&self) -> Option<ActionScope> {
        match self {
            Self::None => None,
            Self::HttpRequest { .. } => Some(ActionScope::HttpRequest),
            Self::WebsocketRequest { .. } => Some(ActionScope::WebsocketRequest),
            Self::GrpcRequest { .. } => Some(ActionScope::GrpcRequest),
            Self::Workspace { .. } => Some(ActionScope::Workspace),
            Self::Folder { .. } => Some(ActionScope::Folder),
            Self::Environment { .. } => Some(ActionScope::Environment),
            Self::Multiple { .. } => None,
        }
    }

    /// Get the ID of the target (if single target).
    pub fn id(&self) -> Option<&str> {
        match self {
            Self::HttpRequest { id }
            | Self::WebsocketRequest { id }
            | Self::GrpcRequest { id }
            | Self::Workspace { id }
            | Self::Folder { id }
            | Self::Environment { id } => Some(id),
            Self::None | Self::Multiple { .. } => None,
        }
    }
}

/// Availability status for an action.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ActionAvailability {
    /// Action is ready to execute.
    Available,

    /// Action can execute but will prompt for missing context.
    AvailableWithPrompt {
        /// Fields that will require prompting.
        prompt_fields: Vec<String>,
    },

    /// Action cannot execute due to missing context.
    Unavailable {
        /// Fields that are missing.
        missing_fields: Vec<String>,
    },

    /// Action not found in registry.
    NotFound,
}

impl ActionAvailability {
    /// Check if the action is available (possibly with prompts).
    pub fn is_available(&self) -> bool {
        matches!(self, Self::Available | Self::AvailableWithPrompt { .. })
    }

    /// Check if the action is immediately available without prompts.
    pub fn is_immediately_available(&self) -> bool {
        matches!(self, Self::Available)
    }
}

/// Check if required context is satisfied by current context.
pub fn check_context_availability(
    required: &RequiredContext,
    current: &CurrentContext,
) -> ActionAvailability {
    let mut missing_fields = Vec::new();
    let mut prompt_fields = Vec::new();

    // Check workspace
    check_field(
        "workspace",
        current.workspace_id.is_some(),
        &required.workspace,
        current.can_prompt,
        &mut missing_fields,
        &mut prompt_fields,
    );

    // Check environment
    check_field(
        "environment",
        current.environment_id.is_some(),
        &required.environment,
        current.can_prompt,
        &mut missing_fields,
        &mut prompt_fields,
    );

    // Check target
    check_field(
        "target",
        current.target.is_some(),
        &required.target,
        current.can_prompt,
        &mut missing_fields,
        &mut prompt_fields,
    );

    // Check window
    check_field(
        "window",
        current.has_window,
        &required.window,
        false, // Can't prompt for window
        &mut missing_fields,
        &mut prompt_fields,
    );

    if !missing_fields.is_empty() {
        ActionAvailability::Unavailable { missing_fields }
    } else if !prompt_fields.is_empty() {
        ActionAvailability::AvailableWithPrompt { prompt_fields }
    } else {
        ActionAvailability::Available
    }
}

fn check_field(
    name: &str,
    has_value: bool,
    requirement: &ContextRequirement,
    can_prompt: bool,
    missing: &mut Vec<String>,
    promptable: &mut Vec<String>,
) {
    match requirement {
        ContextRequirement::NotRequired | ContextRequirement::Optional => {}
        ContextRequirement::Required => {
            if !has_value {
                missing.push(name.to_string());
            }
        }
        ContextRequirement::RequiredWithPrompt => {
            if !has_value {
                if can_prompt {
                    promptable.push(name.to_string());
                } else {
                    missing.push(name.to_string());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_context_available() {
        let required = RequiredContext::requires_target();
        let current = CurrentContext {
            target: Some(ActionTarget::HttpRequest {
                id: "123".to_string(),
            }),
            ..Default::default()
        };

        let availability = check_context_availability(&required, &current);
        assert!(matches!(availability, ActionAvailability::Available));
    }

    #[test]
    fn test_context_missing() {
        let required = RequiredContext::requires_target();
        let current = CurrentContext::default();

        let availability = check_context_availability(&required, &current);
        assert!(matches!(
            availability,
            ActionAvailability::Unavailable { missing_fields } if missing_fields == vec!["target"]
        ));
    }

    #[test]
    fn test_context_promptable() {
        let required = RequiredContext::requires_target_with_prompt();
        let current = CurrentContext {
            can_prompt: true,
            ..Default::default()
        };

        let availability = check_context_availability(&required, &current);
        assert!(matches!(
            availability,
            ActionAvailability::AvailableWithPrompt { prompt_fields } if prompt_fields == vec!["target"]
        ));
    }
}
