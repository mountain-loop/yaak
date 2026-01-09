//! Action executor - central hub for action registration and invocation.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{
    check_context_availability, ActionAvailability, ActionError, ActionGroupId,
    ActionGroupMetadata, ActionGroupSource, ActionGroupWithActions, ActionHandler, ActionId,
    ActionMetadata, ActionParams, ActionResult, ActionScope, ActionSource, CurrentContext,
    RegisteredActionGroup,
};

/// Options for listing actions.
#[derive(Clone, Debug, Default)]
pub struct ListActionsOptions {
    /// Filter by scope.
    pub scope: Option<ActionScope>,
    /// Filter by group.
    pub group_id: Option<ActionGroupId>,
    /// Search term for label/description.
    pub search: Option<String>,
}

/// A registered action with its handler.
struct RegisteredAction {
    /// Action metadata.
    metadata: ActionMetadata,
    /// Where the action was registered from.
    source: ActionSource,
    /// The handler for this action.
    handler: Arc<dyn ActionHandler>,
}

/// Central hub for action registration and invocation.
///
/// The executor owns all action metadata and handlers, ensuring every
/// registered action has a handler by construction.
pub struct ActionExecutor {
    /// All registered actions indexed by ID.
    actions: RwLock<HashMap<ActionId, RegisteredAction>>,

    /// Actions indexed by scope for efficient filtering.
    scope_index: RwLock<HashMap<ActionScope, Vec<ActionId>>>,

    /// All registered groups indexed by ID.
    groups: RwLock<HashMap<ActionGroupId, RegisteredActionGroup>>,
}

impl Default for ActionExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl ActionExecutor {
    /// Create a new empty executor.
    pub fn new() -> Self {
        Self {
            actions: RwLock::new(HashMap::new()),
            scope_index: RwLock::new(HashMap::new()),
            groups: RwLock::new(HashMap::new()),
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Action Registration
    // ─────────────────────────────────────────────────────────────────────────

    /// Register an action with its handler.
    ///
    /// Every action must have a handler - this is enforced by the API.
    pub async fn register<H: ActionHandler + 'static>(
        &self,
        metadata: ActionMetadata,
        source: ActionSource,
        handler: H,
    ) -> Result<ActionId, ActionError> {
        let id = metadata.id.clone();
        let scope = metadata.scope.clone();

        let action = RegisteredAction {
            metadata,
            source,
            handler: Arc::new(handler),
        };

        // Insert action
        {
            let mut actions = self.actions.write().await;
            actions.insert(id.clone(), action);
        }

        // Update scope index
        {
            let mut index = self.scope_index.write().await;
            index.entry(scope).or_default().push(id.clone());
        }

        Ok(id)
    }

    /// Unregister an action.
    pub async fn unregister(&self, id: &ActionId) -> Result<(), ActionError> {
        let mut actions = self.actions.write().await;

        let action = actions
            .remove(id)
            .ok_or_else(|| ActionError::NotFound(id.clone()))?;

        // Update scope index
        {
            let mut index = self.scope_index.write().await;
            if let Some(ids) = index.get_mut(&action.metadata.scope) {
                ids.retain(|i| i != id);
            }
        }

        // Remove from group if assigned
        if let Some(group_id) = &action.metadata.group_id {
            let mut groups = self.groups.write().await;
            if let Some(group) = groups.get_mut(group_id) {
                group.action_ids.retain(|i| i != id);
            }
        }

        Ok(())
    }

    /// Unregister all actions from a specific source.
    pub async fn unregister_source(&self, source_id: &str) -> Vec<ActionId> {
        let actions_to_remove: Vec<ActionId> = {
            let actions = self.actions.read().await;
            actions
                .iter()
                .filter(|(_, a)| match &a.source {
                    ActionSource::Plugin { ref_id, .. } => ref_id == source_id,
                    ActionSource::Dynamic {
                        source_id: sid, ..
                    } => sid == source_id,
                    ActionSource::Builtin => false,
                })
                .map(|(id, _)| id.clone())
                .collect()
        };

        for id in &actions_to_remove {
            let _ = self.unregister(id).await;
        }

        actions_to_remove
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Action Invocation
    // ─────────────────────────────────────────────────────────────────────────

    /// Invoke an action with the given context and parameters.
    ///
    /// This will:
    /// 1. Look up the action metadata
    /// 2. Check context availability
    /// 3. Execute the handler
    pub async fn invoke(
        &self,
        action_id: &ActionId,
        context: CurrentContext,
        params: ActionParams,
    ) -> Result<ActionResult, ActionError> {
        // Get action and handler
        let (metadata, handler) = {
            let actions = self.actions.read().await;
            let action = actions
                .get(action_id)
                .ok_or_else(|| ActionError::NotFound(action_id.clone()))?;
            (action.metadata.clone(), action.handler.clone())
        };

        // Check context availability
        let availability = check_context_availability(&metadata.required_context, &context);

        match availability {
            ActionAvailability::Available | ActionAvailability::AvailableWithPrompt { .. } => {
                // Context is satisfied, proceed with execution
            }
            ActionAvailability::Unavailable { missing_fields } => {
                return Err(ActionError::ContextMissing { missing_fields });
            }
            ActionAvailability::NotFound => {
                return Err(ActionError::NotFound(action_id.clone()));
            }
        }

        // Execute handler
        handler.handle(context, params).await
    }

    /// Invoke an action, skipping context validation.
    ///
    /// Use this when you've already validated the context externally.
    pub async fn invoke_unchecked(
        &self,
        action_id: &ActionId,
        context: CurrentContext,
        params: ActionParams,
    ) -> Result<ActionResult, ActionError> {
        // Get handler
        let handler = {
            let actions = self.actions.read().await;
            let action = actions
                .get(action_id)
                .ok_or_else(|| ActionError::NotFound(action_id.clone()))?;
            action.handler.clone()
        };

        // Execute handler
        handler.handle(context, params).await
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Action Queries
    // ─────────────────────────────────────────────────────────────────────────

    /// Get action metadata by ID.
    pub async fn get(&self, id: &ActionId) -> Option<ActionMetadata> {
        let actions = self.actions.read().await;
        actions.get(id).map(|a| a.metadata.clone())
    }

    /// List all actions, optionally filtered.
    pub async fn list(&self, options: ListActionsOptions) -> Vec<ActionMetadata> {
        let actions = self.actions.read().await;

        let mut result: Vec<_> = actions
            .values()
            .filter(|a| {
                // Scope filter
                if let Some(scope) = &options.scope {
                    if &a.metadata.scope != scope {
                        return false;
                    }
                }

                // Group filter
                if let Some(group_id) = &options.group_id {
                    if a.metadata.group_id.as_ref() != Some(group_id) {
                        return false;
                    }
                }

                // Search filter
                if let Some(search) = &options.search {
                    let search = search.to_lowercase();
                    let matches_label = a.metadata.label.to_lowercase().contains(&search);
                    let matches_desc = a
                        .metadata
                        .description
                        .as_ref()
                        .map(|d| d.to_lowercase().contains(&search))
                        .unwrap_or(false);
                    if !matches_label && !matches_desc {
                        return false;
                    }
                }

                true
            })
            .map(|a| a.metadata.clone())
            .collect();

        // Sort by order then label
        result.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.label.cmp(&b.label)));

        result
    }

    /// List actions available in the given context.
    pub async fn list_available(
        &self,
        context: &CurrentContext,
        options: ListActionsOptions,
    ) -> Vec<(ActionMetadata, ActionAvailability)> {
        let all_actions = self.list(options).await;

        all_actions
            .into_iter()
            .map(|action| {
                let availability =
                    check_context_availability(&action.required_context, context);
                (action, availability)
            })
            .filter(|(_, availability)| availability.is_available())
            .collect()
    }

    /// Get availability status for a specific action.
    pub async fn get_availability(
        &self,
        id: &ActionId,
        context: &CurrentContext,
    ) -> ActionAvailability {
        let actions = self.actions.read().await;

        match actions.get(id) {
            Some(action) => {
                check_context_availability(&action.metadata.required_context, context)
            }
            None => ActionAvailability::NotFound,
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Group Registration
    // ─────────────────────────────────────────────────────────────────────────

    /// Register an action group.
    pub async fn register_group(
        &self,
        metadata: ActionGroupMetadata,
        source: ActionGroupSource,
    ) -> Result<ActionGroupId, ActionError> {
        let id = metadata.id.clone();

        let mut groups = self.groups.write().await;
        if groups.contains_key(&id) {
            return Err(ActionError::GroupAlreadyExists(id));
        }

        groups.insert(
            id.clone(),
            RegisteredActionGroup {
                metadata,
                action_ids: Vec::new(),
                source,
            },
        );

        Ok(id)
    }

    /// Unregister a group (does not unregister its actions).
    pub async fn unregister_group(&self, id: &ActionGroupId) -> Result<(), ActionError> {
        let mut groups = self.groups.write().await;
        groups
            .remove(id)
            .ok_or_else(|| ActionError::GroupNotFound(id.clone()))?;
        Ok(())
    }

    /// Add an action to a group.
    pub async fn add_to_group(
        &self,
        action_id: &ActionId,
        group_id: &ActionGroupId,
    ) -> Result<(), ActionError> {
        // Update action's group_id
        {
            let mut actions = self.actions.write().await;
            let action = actions
                .get_mut(action_id)
                .ok_or_else(|| ActionError::NotFound(action_id.clone()))?;
            action.metadata.group_id = Some(group_id.clone());
        }

        // Add to group's action list
        {
            let mut groups = self.groups.write().await;
            let group = groups
                .get_mut(group_id)
                .ok_or_else(|| ActionError::GroupNotFound(group_id.clone()))?;

            if !group.action_ids.contains(action_id) {
                group.action_ids.push(action_id.clone());
            }
        }

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Group Queries
    // ─────────────────────────────────────────────────────────────────────────

    /// Get a group by ID.
    pub async fn get_group(&self, id: &ActionGroupId) -> Option<ActionGroupMetadata> {
        let groups = self.groups.read().await;
        groups.get(id).map(|g| g.metadata.clone())
    }

    /// List all groups, optionally filtered by scope.
    pub async fn list_groups(&self, scope: Option<ActionScope>) -> Vec<ActionGroupMetadata> {
        let groups = self.groups.read().await;

        let mut result: Vec<_> = groups
            .values()
            .filter(|g| {
                scope.as_ref().map_or(true, |s| {
                    g.metadata.scope.as_ref().map_or(true, |gs| gs == s)
                })
            })
            .map(|g| g.metadata.clone())
            .collect();

        result.sort_by_key(|g| g.order);
        result
    }

    /// List all actions in a specific group.
    pub async fn list_by_group(&self, group_id: &ActionGroupId) -> Vec<ActionMetadata> {
        let groups = self.groups.read().await;
        let actions = self.actions.read().await;

        groups
            .get(group_id)
            .map(|group| {
                let mut result: Vec<_> = group
                    .action_ids
                    .iter()
                    .filter_map(|id| actions.get(id).map(|a| a.metadata.clone()))
                    .collect();
                result.sort_by_key(|a| a.order);
                result
            })
            .unwrap_or_default()
    }

    /// Get actions organized by their groups.
    pub async fn list_grouped(&self, scope: Option<ActionScope>) -> Vec<ActionGroupWithActions> {
        let group_list = self.list_groups(scope).await;
        let mut result = Vec::new();

        for group in group_list {
            let actions = self.list_by_group(&group.id).await;
            result.push(ActionGroupWithActions { group, actions });
        }

        result
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Built-in Registration
    // ─────────────────────────────────────────────────────────────────────────

    /// Register all built-in groups.
    pub async fn register_builtin_groups(&self) -> Result<(), ActionError> {
        for group in crate::groups::builtin::all() {
            self.register_group(group, ActionGroupSource::Builtin).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{handler_fn, RequiredContext};

    async fn create_test_executor() -> ActionExecutor {
        let executor = ActionExecutor::new();
        executor
            .register(
                ActionMetadata {
                    id: ActionId::builtin("test", "echo"),
                    label: "Echo".to_string(),
                    description: None,
                    icon: None,
                    scope: ActionScope::Global,
                    keyboard_shortcut: None,
                    requires_selection: false,
                    enabled_condition: None,
                    group_id: None,
                    order: 0,
                    required_context: RequiredContext::default(),
                },
                ActionSource::Builtin,
                handler_fn(|_ctx, params| async move {
                    let msg: String = params.get("message").unwrap_or_default();
                    Ok(ActionResult::with_message(msg))
                }),
            )
            .await
            .unwrap();
        executor
    }

    #[tokio::test]
    async fn test_register_and_invoke() {
        let executor = create_test_executor().await;
        let action_id = ActionId::builtin("test", "echo");

        let params = ActionParams::from_json(serde_json::json!({
            "message": "Hello, World!"
        }));

        let result = executor
            .invoke(&action_id, CurrentContext::default(), params)
            .await
            .unwrap();

        match result {
            ActionResult::Success { message, .. } => {
                assert_eq!(message, Some("Hello, World!".to_string()));
            }
            _ => panic!("Expected Success result"),
        }
    }

    #[tokio::test]
    async fn test_invoke_not_found() {
        let executor = ActionExecutor::new();
        let action_id = ActionId::builtin("test", "unknown");

        let result = executor
            .invoke(&action_id, CurrentContext::default(), ActionParams::empty())
            .await;

        assert!(matches!(result, Err(ActionError::NotFound(_))));
    }

    #[tokio::test]
    async fn test_list_by_scope() {
        let executor = ActionExecutor::new();

        executor
            .register(
                ActionMetadata {
                    id: ActionId::builtin("global", "one"),
                    label: "Global One".to_string(),
                    description: None,
                    icon: None,
                    scope: ActionScope::Global,
                    keyboard_shortcut: None,
                    requires_selection: false,
                    enabled_condition: None,
                    group_id: None,
                    order: 0,
                    required_context: RequiredContext::default(),
                },
                ActionSource::Builtin,
                handler_fn(|_ctx, _params| async move { Ok(ActionResult::ok()) }),
            )
            .await
            .unwrap();

        executor
            .register(
                ActionMetadata {
                    id: ActionId::builtin("http", "one"),
                    label: "HTTP One".to_string(),
                    description: None,
                    icon: None,
                    scope: ActionScope::HttpRequest,
                    keyboard_shortcut: None,
                    requires_selection: false,
                    enabled_condition: None,
                    group_id: None,
                    order: 0,
                    required_context: RequiredContext::default(),
                },
                ActionSource::Builtin,
                handler_fn(|_ctx, _params| async move { Ok(ActionResult::ok()) }),
            )
            .await
            .unwrap();

        let global_actions = executor
            .list(ListActionsOptions {
                scope: Some(ActionScope::Global),
                ..Default::default()
            })
            .await;
        assert_eq!(global_actions.len(), 1);

        let http_actions = executor
            .list(ListActionsOptions {
                scope: Some(ActionScope::HttpRequest),
                ..Default::default()
            })
            .await;
        assert_eq!(http_actions.len(), 1);
    }

    #[tokio::test]
    async fn test_groups() {
        let executor = ActionExecutor::new();
        executor.register_builtin_groups().await.unwrap();

        let groups = executor.list_groups(None).await;
        assert!(!groups.is_empty());

        let export_group = executor.get_group(&ActionGroupId::builtin("export")).await;
        assert!(export_group.is_some());
        assert_eq!(export_group.unwrap().name, "Export");
    }

    #[tokio::test]
    async fn test_unregister() {
        let executor = create_test_executor().await;
        let action_id = ActionId::builtin("test", "echo");

        assert!(executor.get(&action_id).await.is_some());

        executor.unregister(&action_id).await.unwrap();
        assert!(executor.get(&action_id).await.is_none());
    }
}
