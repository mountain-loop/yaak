//! Core types for the action system.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{ActionGroupId, RequiredContext};

/// Unique identifier for an action.
///
/// Format: `namespace:category:name`
/// - Built-in: `yaak:http-request:send`
/// - Plugin: `plugin.copy-curl:http-request:copy`
#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ActionId(pub String);

impl ActionId {
    /// Create a namespaced action ID.
    pub fn new(namespace: &str, category: &str, name: &str) -> Self {
        Self(format!("{}:{}:{}", namespace, category, name))
    }

    /// Create ID for built-in actions.
    pub fn builtin(category: &str, name: &str) -> Self {
        Self::new("yaak", category, name)
    }

    /// Create ID for plugin actions.
    pub fn plugin(plugin_ref_id: &str, category: &str, name: &str) -> Self {
        Self::new(&format!("plugin.{}", plugin_ref_id), category, name)
    }

    /// Get the raw string value.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ActionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// The scope in which an action can be invoked.
#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum ActionScope {
    /// Global actions available everywhere.
    Global,
    /// Actions on HTTP requests.
    HttpRequest,
    /// Actions on WebSocket requests.
    WebsocketRequest,
    /// Actions on gRPC requests.
    GrpcRequest,
    /// Actions on workspaces.
    Workspace,
    /// Actions on folders.
    Folder,
    /// Actions on environments.
    Environment,
    /// Actions on cookie jars.
    CookieJar,
}

/// Metadata about an action for discovery.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ActionMetadata {
    /// Unique identifier for this action.
    pub id: ActionId,

    /// Display label for the action.
    pub label: String,

    /// Optional description of what the action does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Icon name to display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// The scope this action applies to.
    pub scope: ActionScope,

    /// Keyboard shortcut (e.g., "Cmd+Enter").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyboard_shortcut: Option<String>,

    /// Whether the action requires a selection/target.
    #[serde(default)]
    pub requires_selection: bool,

    /// Optional condition expression for when action is enabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled_condition: Option<String>,

    /// Optional group this action belongs to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<ActionGroupId>,

    /// Sort order within a group (lower = earlier).
    #[serde(default)]
    pub order: i32,

    /// Context requirements for this action.
    #[serde(default)]
    pub required_context: RequiredContext,
}

/// Where an action was registered from.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ActionSource {
    /// Built into Yaak core.
    Builtin,
    /// Registered by a plugin.
    Plugin {
        /// Plugin reference ID.
        ref_id: String,
        /// Plugin name.
        name: String,
    },
    /// Registered at runtime (e.g., by MCP tools).
    Dynamic {
        /// Source identifier.
        source_id: String,
    },
}

/// Parameters passed to action handlers.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ActionParams {
    /// Arbitrary JSON parameters.
    #[serde(default)]
    #[ts(type = "unknown")]
    pub data: serde_json::Value,
}

impl ActionParams {
    /// Create empty params.
    pub fn empty() -> Self {
        Self {
            data: serde_json::Value::Null,
        }
    }

    /// Create params from a JSON value.
    pub fn from_json(data: serde_json::Value) -> Self {
        Self { data }
    }

    /// Get a typed value from the params.
    pub fn get<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        self.data
            .get(key)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }
}

/// Result of action execution.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ActionResult {
    /// Action completed successfully.
    Success {
        /// Optional data to return.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(type = "unknown")]
        data: Option<serde_json::Value>,
        /// Optional message to display.
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },

    /// Action requires user input to continue.
    RequiresInput {
        /// Prompt to show user.
        prompt: InputPrompt,
        /// Continuation token.
        continuation_id: String,
    },

    /// Action was cancelled by the user.
    Cancelled,
}

impl ActionResult {
    /// Create a success result with no data.
    pub fn ok() -> Self {
        Self::Success {
            data: None,
            message: None,
        }
    }

    /// Create a success result with a message.
    pub fn with_message(message: impl Into<String>) -> Self {
        Self::Success {
            data: None,
            message: Some(message.into()),
        }
    }

    /// Create a success result with data.
    pub fn with_data(data: serde_json::Value) -> Self {
        Self::Success {
            data: Some(data),
            message: None,
        }
    }
}

/// A prompt for user input.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum InputPrompt {
    /// Text input prompt.
    Text {
        label: String,
        placeholder: Option<String>,
        default_value: Option<String>,
    },
    /// Selection prompt.
    Select {
        label: String,
        options: Vec<SelectOption>,
    },
    /// Confirmation prompt.
    Confirm { label: String },
}

/// An option in a select prompt.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SelectOption {
    pub label: String,
    pub value: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_action_id_creation() {
        let id = ActionId::builtin("http-request", "send");
        assert_eq!(id.as_str(), "yaak:http-request:send");

        let plugin_id = ActionId::plugin("copy-curl", "http-request", "copy");
        assert_eq!(plugin_id.as_str(), "plugin.copy-curl:http-request:copy");
    }

    #[test]
    fn test_action_params() {
        let params = ActionParams::from_json(serde_json::json!({
            "name": "test",
            "count": 42
        }));

        assert_eq!(params.get::<String>("name"), Some("test".to_string()));
        assert_eq!(params.get::<i32>("count"), Some(42));
        assert_eq!(params.get::<String>("missing"), None);
    }
}
