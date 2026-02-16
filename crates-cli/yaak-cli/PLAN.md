# CLI Command Architecture Plan

## Goal

Redesign the yaak-cli command structure to use a resource-oriented `<resource> <action>`
pattern that scales well, is discoverable, and supports both human and LLM workflows.

## Status Snapshot

Current branch state:

- Modular CLI structure with command modules and shared `CliContext`
- Resource/action hierarchy in place for:
  - `workspace list|show|create|update|delete`
  - `request list|show|create|update|send|delete`
  - `folder list|show|create|update|delete`
  - `environment list|show|create|update|delete`
- Top-level `send` exists as a request-send shortcut (not yet flexible request/folder/workspace resolution)
- Legacy `get` command removed
- JSON create/update flow implemented (`--json` and positional JSON shorthand)
- No `request schema` command yet

Progress checklist:

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete
- [ ] Phase 6 complete

## Command Architecture

### Design Principles

- **Resource-oriented**: top-level commands are nouns, subcommands are verbs
- **Polymorphic requests**: `request` covers HTTP, gRPC, and WebSocket — the CLI
  resolves the type via `get_any_request` and adapts behavior accordingly
- **Simple creation, full-fidelity via JSON**: human-friendly flags for basic creation,
  `--json` for full control (targeted at LLM and scripting workflows)
- **Runtime schema introspection**: `request schema` outputs JSON Schema for the request
  models, with dynamic auth fields populated from loaded plugins at runtime
- **Destructive actions require confirmation**: `delete` commands prompt for user
  confirmation before proceeding. Can be bypassed with `--yes` / `-y` for scripting

### Commands

```
# Top-level shortcut
yaakcli send <id> [-e <env_id>]          # id can be a request, folder, or workspace

# Resource commands
yaakcli workspace list
yaakcli workspace show <id>
yaakcli workspace create --name <name>
yaakcli workspace create --json '{"name": "My Workspace"}'
yaakcli workspace create '{"name": "My Workspace"}'              # positional JSON shorthand
yaakcli workspace update --json '{"id": "wk_abc", "name": "New Name"}'
yaakcli workspace delete <id>

yaakcli request list <workspace_id>
yaakcli request show <id>
yaakcli request create <workspace_id> --name <name> --url <url> [--method GET]
yaakcli request create --json '{"workspaceId": "wk_abc", "url": "..."}'
yaakcli request update --json '{"id": "rq_abc", "url": "https://new.com"}'
yaakcli request send <id> [-e <env_id>]
yaakcli request delete <id>
yaakcli request schema <http|grpc|websocket>

yaakcli folder list <workspace_id>
yaakcli folder show <id>
yaakcli folder create <workspace_id> --name <name>
yaakcli folder create --json '{"workspaceId": "wk_abc", "name": "Auth"}'
yaakcli folder update --json '{"id": "fl_abc", "name": "New Name"}'
yaakcli folder delete <id>

yaakcli environment list <workspace_id>
yaakcli environment show <id>
yaakcli environment create <workspace_id> --name <name>
yaakcli environment create --json '{"workspaceId": "wk_abc", "name": "Production"}'
yaakcli environment update --json '{"id": "ev_abc", ...}'
yaakcli environment delete <id>

```

### `send` — Top-Level Shortcut

`yaakcli send <id>` is a convenience alias that accepts any sendable ID. It tries
each type in order via DB lookups (short-circuiting on first match):

1. Request (HTTP, gRPC, or WebSocket via `get_any_request`)
2. Folder (sends all requests in the folder)
3. Workspace (sends all requests in the workspace)

ID prefixes exist (e.g. `rq_`, `fl_`, `wk_`) but are not relied upon — resolution
is purely by DB lookup.

`request send <id>` is the same but restricted to request IDs only.

### Request Send — Polymorphic Behavior

`send` means "execute this request" regardless of protocol:

- **HTTP**: send request, print response, exit
- **gRPC**: invoke the method; for streaming, stream output to stdout until done/Ctrl+C
- **WebSocket**: connect, stream messages to stdout until closed/Ctrl+C

### `request schema` — Runtime JSON Schema

Outputs a JSON Schema describing the full request shape, including dynamic fields:

1. Generate base schema from `schemars::JsonSchema` derive on the Rust model structs
2. Load plugins, collect auth strategy definitions and their form inputs
3. Merge plugin-defined auth fields into the `authentication` property as a `oneOf`
4. Output the combined schema as JSON

This lets an LLM call `schema`, read the shape, and construct valid JSON for
`create --json` or `update --json`.

## Implementation Steps

### Phase 1: Restructure commands (no new functionality)

Refactor `main.rs` into the new resource/action pattern using clap subcommand nesting.
Existing behavior stays the same, just reorganized. Remove the `get` command.

1. Create module structure: `commands/workspace.rs`, `commands/request.rs`, etc.
2. Define nested clap enums:
   ```rust
   enum Commands {
       Send(SendArgs),
       Workspace(WorkspaceArgs),
       Request(RequestArgs),
       Folder(FolderArgs),
       Environment(EnvironmentArgs),
   }
   ```
3. Move existing `Workspaces` logic into `workspace list`
4. Move existing `Requests` logic into `request list`
5. Move existing `Send` logic into `request send`
6. Move existing `Create` logic into `request create`
7. Delete the `Get` command entirely
8. Extract shared setup (DB init, plugin init, encryption) into a reusable context struct

### Phase 2: Add missing CRUD commands

Status: complete

1. `workspace show <id>`
2. `workspace create --name <name>` (and `--json`)
3. `workspace update --json`
4. `workspace delete <id>`
5. `request show <id>` (JSON output of the full request model)
6. `request delete <id>`
7. `folder list <workspace_id>`
8. `folder show <id>`
9. `folder create <workspace_id> --name <name>` (and `--json`)
10. `folder update --json`
11. `folder delete <id>`
12. `environment list <workspace_id>`
13. `environment show <id>`
14. `environment create <workspace_id> --name <name>` (and `--json`)
15. `environment update --json`
16. `environment delete <id>`

### Phase 3: JSON input for create/update

Both commands accept JSON via `--json <string>` or as a positional argument (detected
by leading `{`). They follow the same upsert pattern as the plugin API.

- **`create --json`**: JSON must include `workspaceId`. Must NOT include `id` (or
  use empty string `""`). Deserializes into the model with defaults for missing fields,
  then upserts (insert).
- **`update --json`**: JSON must include `id`. Performs a fetch-merge-upsert:
  1. Fetch the existing model from DB
  2. Serialize it to `serde_json::Value`
  3. Deep-merge the user's partial JSON on top (JSON Merge Patch / RFC 7386 semantics)
  4. Deserialize back into the typed model
  5. Upsert (update)

  This matches how the MCP server plugin already does it (fetch existing, spread, override),
  but the CLI handles the merge server-side so callers don't have to.

  Setting a field to `null` removes it (for `Option<T>` fields), per RFC 7386.

Implementation:
1. Add `--json` flag and positional JSON detection to `create` commands
2. Add `update` commands with required `--json` flag
3. Implement JSON merge utility (or use `json-patch` crate)

### Phase 4: Runtime schema generation

1. Add `schemars` dependency to `yaak-models`
2. Derive `JsonSchema` on `HttpRequest`, `GrpcRequest`, `WebsocketRequest`, and their
   nested types (`HttpRequestHeader`, `HttpUrlParameter`, etc.)
3. Implement `request schema` command:
   - Generate base schema from schemars
   - Query plugins for auth strategy form inputs
   - Convert plugin form inputs into JSON Schema properties
   - Merge into the `authentication` field
   - Print to stdout

### Phase 5: Polymorphic send

1. Update `request send` to use `get_any_request` to resolve the request type
2. Match on `AnyRequest` variant and dispatch to the appropriate sender:
   - `AnyRequest::HttpRequest` — existing HTTP send logic
   - `AnyRequest::GrpcRequest` — gRPC invoke (future implementation)
   - `AnyRequest::WebsocketRequest` — WebSocket connect (future implementation)
3. gRPC and WebSocket send can initially return "not yet implemented" errors

### Phase 6: Top-level `send` and folder/workspace send

1. Add top-level `yaakcli send <id>` command
2. Resolve ID by trying DB lookups in order: any_request → folder → workspace
3. For folder: list all requests in folder, send each
4. For workspace: list all requests in workspace, send each
5. Add execution options: `--sequential` (default), `--parallel`, `--fail-fast`

## Execution Plan (PR Slices)

### PR 1: Command tree refactor + compatibility aliases

Scope:

1. Introduce `commands/` modules and a `CliContext` for shared setup
2. Add new clap hierarchy (`workspace`, `request`, `folder`, `environment`)
3. Route existing behavior into:
   - `workspace list`
   - `request list <workspace_id>`
   - `request send <id>`
   - `request create <workspace_id> ...`
4. Keep compatibility aliases temporarily:
   - `workspaces` -> `workspace list`
   - `requests <workspace_id>` -> `request list <workspace_id>`
   - `create ...` -> `request create ...`
5. Remove `get` and update help text

Acceptance criteria:

- `yaakcli --help` shows noun/verb structure
- Existing list/send/create workflows still work
- No behavior change in HTTP send output format

### PR 2: CRUD surface area

Scope:

1. Implement `show/create/update/delete` for `workspace`, `request`, `folder`, `environment`
2. Ensure delete commands require confirmation by default (`--yes` bypass)
3. Normalize output format for list/show/create/update/delete responses

Acceptance criteria:

- Every command listed in the "Commands" section parses and executes
- Delete commands are safe by default in interactive terminals
- `--yes` supports non-interactive scripts

### PR 3: JSON input + merge patch semantics

Scope:

1. Add shared parser for `--json` and positional JSON shorthand
2. Add `create --json` and `update --json` for all mutable resources
3. Implement server-side RFC 7386 merge patch behavior
4. Add guardrails:
   - `create --json`: reject non-empty `id`
   - `update --json`: require `id`

Acceptance criteria:

- Partial `update --json` only modifies provided keys
- `null` clears optional values
- Invalid JSON and missing required fields return actionable errors

### PR 4: `request schema` and plugin auth integration

Scope:

1. Add `schemars` to `yaak-models` and derive `JsonSchema` for request models
2. Implement `request schema <http|grpc|websocket>`
3. Merge plugin auth form inputs into `authentication` schema at runtime

Acceptance criteria:

- Command prints valid JSON schema
- Schema reflects installed auth providers at runtime
- No panic when plugins fail to initialize (degrade gracefully)

### PR 5: Polymorphic request send

Scope:

1. Replace request resolution in `request send` with `get_any_request`
2. Dispatch by request type
3. Keep HTTP fully functional
4. Return explicit NYI errors for gRPC/WebSocket until implemented

Acceptance criteria:

- HTTP behavior remains unchanged
- gRPC/WebSocket IDs are recognized and return explicit status

### PR 6: Top-level `send` + bulk execution

Scope:

1. Add top-level `send <id>` for request/folder/workspace IDs
2. Implement folder/workspace fan-out execution
3. Add execution controls: `--sequential`, `--parallel`, `--fail-fast`

Acceptance criteria:

- Correct ID dispatch order: request -> folder -> workspace
- Deterministic summary output (success/failure counts)
- Non-zero exit code when any request fails (unless explicitly configured otherwise)

## Validation Matrix

1. CLI parsing tests for every command path (including aliases while retained)
2. Integration tests against temp SQLite DB for CRUD flows
3. Snapshot tests for output text where scripting compatibility matters
4. Manual smoke tests:
   - Send HTTP request with template/rendered vars
   - JSON create/update for each resource
   - Delete confirmation and `--yes`
   - Top-level `send` on request/folder/workspace

## Open Questions

1. Should compatibility aliases (`workspaces`, `requests`, `create`) be removed immediately or after one release cycle?
2. For bulk `send`, should default behavior stop on first failure or continue and summarize?
3. Should command output default to human-readable text with an optional `--format json`, or return JSON by default for `show`/`list`?
4. For `request schema`, should plugin-derived auth fields be namespaced by plugin ID to avoid collisions?

## Crate Changes

- **yaak-cli**: restructure into modules, new clap hierarchy
- **yaak-models**: add `schemars` dependency, derive `JsonSchema` on model structs
  (current derives: `Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS`)
