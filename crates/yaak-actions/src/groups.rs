//! Action group types and management.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{ActionId, ActionMetadata, ActionScope};

/// Unique identifier for an action group.
///
/// Format: `namespace:group-name`
/// - Built-in: `yaak:export`
/// - Plugin: `plugin.my-plugin:utilities`
#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ActionGroupId(pub String);

impl ActionGroupId {
    /// Create a namespaced group ID.
    pub fn new(namespace: &str, name: &str) -> Self {
        Self(format!("{}:{}", namespace, name))
    }

    /// Create ID for built-in groups.
    pub fn builtin(name: &str) -> Self {
        Self::new("yaak", name)
    }

    /// Create ID for plugin groups.
    pub fn plugin(plugin_ref_id: &str, name: &str) -> Self {
        Self::new(&format!("plugin.{}", plugin_ref_id), name)
    }

    /// Get the raw string value.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ActionGroupId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Metadata about an action group.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ActionGroupMetadata {
    /// Unique identifier for this group.
    pub id: ActionGroupId,

    /// Display name for the group.
    pub name: String,

    /// Optional description of the group's purpose.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Icon to display for the group.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// Sort order for displaying groups (lower = earlier).
    #[serde(default)]
    pub order: i32,

    /// Optional scope restriction (if set, group only appears in this scope).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<ActionScope>,
}

/// Where an action group was registered from.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ActionGroupSource {
    /// Built into Yaak core.
    Builtin,
    /// Registered by a plugin.
    Plugin {
        /// Plugin reference ID.
        ref_id: String,
        /// Plugin name.
        name: String,
    },
    /// Registered at runtime.
    Dynamic {
        /// Source identifier.
        source_id: String,
    },
}

/// A registered action group with its actions.
#[derive(Clone, Debug)]
pub struct RegisteredActionGroup {
    /// Group metadata.
    pub metadata: ActionGroupMetadata,

    /// IDs of actions in this group (ordered by action's order field).
    pub action_ids: Vec<ActionId>,

    /// Where the group was registered from.
    pub source: ActionGroupSource,
}

/// A group with its actions for UI rendering.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ActionGroupWithActions {
    /// Group metadata.
    pub group: ActionGroupMetadata,

    /// Actions in this group.
    pub actions: Vec<ActionMetadata>,
}

/// Built-in action group definitions.
pub mod builtin {
    use super::*;

    /// Export group - export and copy actions.
    pub fn export() -> ActionGroupMetadata {
        ActionGroupMetadata {
            id: ActionGroupId::builtin("export"),
            name: "Export".into(),
            description: Some("Export and copy actions".into()),
            icon: Some("download".into()),
            order: 100,
            scope: None,
        }
    }

    /// Code generation group.
    pub fn code_generation() -> ActionGroupMetadata {
        ActionGroupMetadata {
            id: ActionGroupId::builtin("code-generation"),
            name: "Code Generation".into(),
            description: Some("Generate code snippets from requests".into()),
            icon: Some("code".into()),
            order: 200,
            scope: Some(ActionScope::HttpRequest),
        }
    }

    /// Send group - request sending actions.
    pub fn send() -> ActionGroupMetadata {
        ActionGroupMetadata {
            id: ActionGroupId::builtin("send"),
            name: "Send".into(),
            description: Some("Actions for sending requests".into()),
            icon: Some("play".into()),
            order: 50,
            scope: Some(ActionScope::HttpRequest),
        }
    }

    /// Import group.
    pub fn import() -> ActionGroupMetadata {
        ActionGroupMetadata {
            id: ActionGroupId::builtin("import"),
            name: "Import".into(),
            description: Some("Import data from files".into()),
            icon: Some("upload".into()),
            order: 150,
            scope: None,
        }
    }

    /// Workspace management group.
    pub fn workspace() -> ActionGroupMetadata {
        ActionGroupMetadata {
            id: ActionGroupId::builtin("workspace"),
            name: "Workspace".into(),
            description: Some("Workspace management actions".into()),
            icon: Some("folder".into()),
            order: 300,
            scope: Some(ActionScope::Workspace),
        }
    }

    /// Get all built-in group definitions.
    pub fn all() -> Vec<ActionGroupMetadata> {
        vec![send(), export(), import(), code_generation(), workspace()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_group_id_creation() {
        let id = ActionGroupId::builtin("export");
        assert_eq!(id.as_str(), "yaak:export");

        let plugin_id = ActionGroupId::plugin("my-plugin", "utilities");
        assert_eq!(plugin_id.as_str(), "plugin.my-plugin:utilities");
    }

    #[test]
    fn test_builtin_groups() {
        let groups = builtin::all();
        assert!(!groups.is_empty());
        assert!(groups.iter().any(|g| g.id == ActionGroupId::builtin("export")));
    }
}
