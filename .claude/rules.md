# Project Rules

## General Development
- **NEVER** commit or push without explicit confirmation

## Build and Lint
- **ALWAYS** run `npm run lint` after modifying TypeScript or JavaScript files
- Run `npm run bootstrap` after changing plugin runtime or MCP server code

## Plugin System

### Backend Constraints
- Always use `UpdateSource::Plugin` when calling database methods from plugin events
- Never send timestamps (`createdAt`, `updatedAt`) from TypeScript - Rust backend controls these
- Backend uses `NaiveDateTime` (no timezone) so avoid sending ISO timestamp strings

### MCP Server
- MCP server has **no active window context** - cannot call `window.workspaceId()`
- Get workspace ID from `workspaceCtx.yaak.workspace.list()` instead

## Rust Type Generation
- Run `cd src-tauri && cargo test --package yaak-plugins` to regenerate TypeScript bindings after modifying Rust event types
