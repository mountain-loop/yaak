# Unified Actions System (Proxy App)

## Context

The proxy app is greenfield — no existing hotkeys, context menus, or command palette to migrate. This is an opportunity to build the actions system right from the start, so every interactive feature is powered by a single shared registry.

## Goals

- One place to define every user-facing action (label, icon, default hotkey)
- Actions can be triggered from hotkeys, context menus, command palette, native menus, or toolbar buttons
- Rust-defined enums exported to TypeScript via ts-rs for type safety
- Actions are either **Core** (handled in Rust) or **Frontend** (handled in TypeScript)
- All dispatch goes through one Rust `execute_action()` function — callable as an RPC command (from frontend) or directly (from native menus / Rust code)

## Relationship to RPC

Actions sit **on top of** the RPC layer. RPC is the transport; actions are user intent.

- `execute_action` is an RPC command — the frontend calls it to trigger any action
- Core action handlers live in Rust and contain the business logic directly
- Frontend action handlers live in TypeScript — when Rust receives a frontend action, it emits a Tauri event and the frontend listener handles it
- Actions carry no params — they use defaults or derive what they need from scope context (e.g., `http_exchange_id`). Standalone RPC commands like `proxy_start`/`proxy_stop` go away — `execute_action` is the only entry point.

```
Native Tauri menu / Rust code
  → execute_action(ActionInvocation)
  → Core? → call handler directly
  → Frontend? → emit event to frontend → frontend handles

Frontend hotkey / context menu / command palette
  → rpc("execute_action", ActionInvocation)
  → same execute_action() function
  → Core? → call handler directly
  → Frontend? → emit event back to frontend → frontend handles
```

## Scopes

| Scope | Context | Example actions |
|-------|---------|-----------------|
| `Global` | (none) | start/stop proxy, clear history, zoom, toggle command palette |
| `HttpExchange` | `http_exchange_id: String` | view details, copy URL, copy as cURL, delete, replay |

Start small — more scopes can be added later as the app grows.

## Rust Types

### Action enums (per scope, split Core / Frontend)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_actions.ts")]
pub enum GlobalCoreAction {
    ProxyStart,
    ProxyStop,
    ClearHistory,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_actions.ts")]
pub enum GlobalFrontendAction {
    ToggleCommandPalette,
    ZoomIn,
    ZoomOut,
    ZoomReset,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_actions.ts")]
pub enum HttpExchangeCoreAction {
    Delete,
    Replay,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_actions.ts")]
pub enum HttpExchangeFrontendAction {
    ViewDetails,
    CopyUrl,
    CopyAsCurl,
}
```

### Invocation enum

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "scope", rename_all = "snake_case")]
#[ts(export, export_to = "gen_actions.ts")]
pub enum ActionInvocation {
    Global { action: GlobalAction },
    HttpExchange { action: HttpExchangeAction, http_exchange_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "handler", content = "action", rename_all = "snake_case")]
#[ts(export, export_to = "gen_actions.ts")]
pub enum GlobalAction {
    Core(GlobalCoreAction),
    Frontend(GlobalFrontendAction),
}
// same for HttpExchangeAction
```

### Action metadata

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_actions.ts")]
pub struct ActionMetadata {
    pub label: String,
    pub icon: Option<String>,
    pub default_hotkey_mac: Option<Vec<String>>,
    pub default_hotkey_other: Option<Vec<String>>,
}

pub fn action_metadata(action: &ActionInvocation) -> ActionMetadata { ... }
```

### Dispatch function

```rust
pub fn execute_action(ctx: &ProxyCtx, invocation: ActionInvocation) -> Result<(), RpcError> {
    match invocation {
        ActionInvocation::Global { action: GlobalAction::Core(a) } => match a {
            GlobalCoreAction::ProxyStart => {
                // Start proxy on default port (9090)
                // Business logic lives here, not in a separate RPC command
                let mut handle = ctx.handle.lock()...;
                let proxy_handle = yaak_proxy::start_proxy(9090)?;
                // ...
                Ok(())
            }
            GlobalCoreAction::ProxyStop => {
                let mut handle = ctx.handle.lock()...;
                handle.take(); // Drop stops the proxy
                Ok(())
            }
            GlobalCoreAction::ClearHistory => { /* ... */ Ok(()) }
        },
        ActionInvocation::Global { action: GlobalAction::Frontend(_) } => {
            // Emit event — frontend listener handles it
            ctx.events.emit("action_invoke", &invocation);
            Ok(())
        }
        ActionInvocation::HttpExchange { action, http_exchange_id } => {
            // similar pattern
            todo!()
        }
    }
}
```

## TypeScript Side

```typescript
// Dispatch any action — always goes through Rust
async function dispatch(invocation: ActionInvocation) {
  await rpc("execute_action", invocation);
}

// Listen for frontend actions emitted by Rust
listen("action_invoke", (invocation: ActionInvocation) => {
  // Route to the right handler
  const handler = frontendHandlers[invocation.scope]?.[invocation.action.action];
  handler?.(invocation);
});

// Type-safe exhaustive handlers
type FrontendHandlers = {
  global: Record<GlobalFrontendAction, () => void>;
  http_exchange: Record<HttpExchangeFrontendAction, (ctx: { http_exchange_id: string }) => void>;
};
```

## Crate Location

`crates-proxy/yaak-proxy-actions/` — action enums, metadata, `execute_action()` function, ts-rs exports. Referenced by `yaak-proxy-lib` to register as an RPC command.

## Implementation Steps

### Step 1: Rust action definitions + dispatch
- Create `crates-proxy/yaak-proxy-actions/` with enums, `ActionInvocation`, metadata, `execute_action()`
- ts-rs generates `bindings/gen_actions.ts`
- Add `execute_action` to `define_rpc!` in `yaak-proxy-lib`

### Step 2: TypeScript dispatch + handlers
- Create `apps/yaak-proxy/actions.ts`
- Import generated types, define `FrontendHandlers`, wire `dispatch()`
- Listen for `action_invoke` events (for Rust-initiated frontend actions)

### Step 3: Wire up UI
- Toolbar buttons call `dispatch()` instead of inline `rpc()` calls
- Add context menu on exchange table rows using action items
- Build a basic command palette from the action registry

## Verification

- `cargo check -p yaak-proxy-actions`
- `tsgo --noEmit` from repo root
- Toolbar start/stop still works (now via actions)
- Right-click exchange row shows context menu with correct labels
- Command palette lists available actions
