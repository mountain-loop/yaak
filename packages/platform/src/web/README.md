# The browser host

Yaak running in a plain tab: no install, no local process. The desktop's own
model layer — `yaak-models`, SQLite included — runs compiled to wasm inside a
worker the tab talks to, so a browser stores exactly what a desktop install
stores, migrations and all.

Select it at build time and run the frontend alone:

```shell
YAAK_TARGET=web npm run dev --workspace @yaakapp/yaak-client
```

The flag resolves `@yaakapp-internal/platform` to `../index.web.ts`, which
installs this host instead of the Tauri one. It is a separate entry rather than
a branch inside `index.ts` so that a web build never pulls `@tauri-apps/*` into
the module graph at all — a folded branch would drop the code but keep the
imports it guarded.

Desktop builds are untouched: without the flag, `packages/platform/src/index.ts`
installs the Tauri host exactly as before.

## How it fits together

```
tab (index.ts, commands.ts) ──MessagePort──▶ worker.ts ──▶ @yaakapp-internal/web (wasm)
                            ◀── model_writes ──          crates/yaak-web → yaak-models → SQLite
                                                                        └─ pages in IndexedDB
```

| File | What it is |
| --- | --- |
| `index.ts` | The `Platform` implementation. |
| `commands.ts` | The command table: model commands forward to the worker; the rest is fixed answers and refusals-with-a-reason. |
| `connection.ts` | A tab's end of the wire: request/response over a `MessagePort`, event delivery, and the tab's identity (`label`). |
| `worker.ts` | The process that owns the database. Loads the wasm, opens the DB once, answers each port, fans `model_writes` out to every port. |
| `protocol.ts` | The message shapes both sides import. |
| `errors.ts` | `UnsupportedCommandError`, the structured refusal. |
| `storage.ts` | `navigator.storage.persist()`. |

The Rust side is `crates/yaak-web` (`@yaakapp-internal/web`): `boot()`,
`rpc(cmd, payload, label)` returning `{ result, events }`, and blob get/put.
Its `pkg/` is committed; rebuilding needs a clang with a WebAssembly backend
(`brew install llvm`), and `build-wasm.cjs` skips with a notice when there
isn't one, so a desktop `npm run bootstrap` never depends on it.

Behaviours worth knowing before changing anything:

- **The worker is a `SharedWorker`**, which is what makes "one database, many
  tabs" true by construction — and makes the browser look like the desktop:
  one process holds the data, every window talks to it, it pushes writes to
  all of them. Where `SharedWorker` is missing (Android Chrome) or its script
  can't be fetched (some embedded browsers), the connection falls back to a
  dedicated worker that takes a Web Lock; a second tab then gets a clear
  "already open in another tab" instead of a second SQLite over the same pages.
- **Every write is stamped with the calling tab's `label`** as
  `UpdateSource::Window`, exactly like a desktop window label, so the frontend
  store's echo handling is unchanged.
- **Cascade rules, duplicate naming, id generation, serde defaults, and the
  lazy first-run bootstrap are all the Rust code's.** Nothing about what a
  model *is* is decided in TypeScript.
- **Persistence is `relaxed-idb`**: SQLite pages live in IndexedDB, writes land
  in memory and flush shortly after. A tab closing mid-flush loses at most the
  last few writes.

## Commands

109 commands are declared in `@yaakapp-internal/rpc-schema`. This host answers
31, declines 44 by name with a reason, and refuses the remaining 34 generically.

### Implemented (31)

| Group | Commands |
| --- | --- |
| Models | `models_workspace_models`, `models_upsert`, `models_delete`, `models_duplicate`, `models_get_settings`, `models_get_graphql_introspection`, `models_upsert_graphql_introspection`, `models_grpc_events`, `models_websocket_events` |
| App | `cmd_metadata`, `cmd_get_workspace_meta`, `cmd_default_headers`, `cmd_get_themes`, `cmd_check_for_updates`, `cmd_dismiss_notification`, `cmd_plugin_init_errors` |
| Bodies | `cmd_http_response_body`, `cmd_http_response_body_path`, `cmd_http_request_body`, `cmd_get_http_response_events`, `cmd_get_sse_events` |
| Plugin surfaces (empty results) | `cmd_http_request_actions`, `cmd_websocket_request_actions`, `cmd_grpc_request_actions`, `cmd_workspace_actions`, `cmd_folder_actions`, `cmd_template_function_summaries`, `cmd_get_http_authentication_summaries`, `cmd_get_http_authentication_config` |
| Text | `cmd_format_json`, `cmd_render_template` |

Some of these answer honestly rather than fully, and the difference matters:

- `cmd_render_template` returns the template **unrendered**. Resolving variables
  and calling template functions is plugin work. The preview shows the raw
  `${[…]}` rather than a wrong value.
- `cmd_get_http_authentication_summaries` returns the auth methods Yaak ships as
  plugins, so the picker is truthful about the product — but
  `cmd_get_http_authentication_config` returns an empty form, because the plugin
  that defines the form isn't running.
- `cmd_template_function_summaries` returns one provider contributing no
  functions. Both summary commands are polled every second until they return
  something, so an empty list is a poll that never stops rather than a quiet no.
- `cmd_metadata` reports empty strings for the data, log, plugin and project
  directories. There is no filesystem behind this host.

### Declined by name (44)

Each returns an `UnsupportedCommandError` carrying `cmd`, a user-facing
`message`, and the `capability` a caller should have checked. The UI turns it
into a toast.

| Reason | Commands |
| --- | --- |
| Sending isn't available yet (slice 2) | `cmd_send_http_request`, `cmd_send_ephemeral_request`, `cmd_delete_send_history`, `cmd_delete_all_http_responses`, `cmd_import_url` |
| No plugin runtime | `cmd_reload_plugins`, `cmd_plugin_info`, `cmd_plugins_search`, `cmd_plugins_install`, `cmd_plugins_install_from_directory`, `cmd_plugins_uninstall`, `cmd_plugins_updates`, `cmd_plugins_update_all`, `cmd_template_function_config`, `cmd_template_tokens_to_string`, `cmd_call_http_request_action`, `cmd_call_websocket_request_action`, `cmd_call_grpc_request_action`, `cmd_call_workspace_action`, `cmd_call_folder_action`, `cmd_call_http_authentication_action`, `cmd_curl_to_request`, `cmd_format_graphql` |
| No filesystem | `cmd_import_data`, `cmd_export_data`, `cmd_save_response`, `cmd_save_base64_to_binary` |
| Needs a real socket | `cmd_grpc_reflect`, `cmd_grpc_go`, `cmd_delete_all_grpc_connections`, `cmd_ws_connect`, `cmd_ws_send`, `cmd_ws_close`, `cmd_ws_delete_connections` |
| Workspace encryption | `cmd_enable_encryption`, `cmd_disable_encryption`, `cmd_reveal_workspace_key`, `cmd_set_workspace_key`, `cmd_secure_template`, `cmd_decrypt_template` |
| One tab, no windows | `cmd_new_child_window`, `cmd_new_main_window`, `cmd_restart` |
| Other | `cmd_send_feedback` |

### Refused generically (34)

The 30 `cmd_git_*` commands and `cmd_sync_calculate`, `cmd_sync_calculate_fs`,
`cmd_sync_apply`, `cmd_sync_watch`. Nothing in the app reaches them unless a
workspace has a sync directory, which a browser tab cannot set.

Anything added to the schema later also lands here, and the error names the
command — an unlisted command is a gap in `commands.ts`, and whoever hits it
should be able to see which.

## Capabilities

Reported honestly, so callers gate on the question rather than on the host:

| True | False |
| --- | --- |
| `cookieJar` (the jar stores and edits here; only filling it needs the sender) | `grpc`, `websocket`, `git`, `sync`, `tlsOptions`, `localFiles`, `timeline`, `multiWindow`, `plugins`, `encryption`, `updater`, `clipboardRead`, `systemFonts`, `license` |

`multiWindow: false` means the host cannot open a *second window* on demand —
what `cmd_new_child_window` does for Settings and workspace switching. It is not
a claim that nothing else is looking: other tabs may well be open on the same
worker, and it pushes every write to all of them regardless.

## Multiple tabs

Each tab mints a label at load (`tab_xxxxxxxx`) and sends it with every command;
the worker stamps writes with it as `UpdateSource::Window { label }`, standing in
for the desktop's window label. The worker fans each write out to every
connected tab, and the receiving tab's store applies or ignores it exactly as a
desktop window would.

The label is deliberately *not* kept in `sessionStorage`: duplicating a tab
copies session storage, and two tabs sharing one identity would each mistake the
other's writes for an echo of their own and drop them.

## Known gaps

- **Storage persistence is requested, not guaranteed.** `navigator.storage.persist()`
  runs at boot; browsers grant it on their own heuristics and often decline on
  `localhost`.
- **`pkg/yaak_web_bg.wasm` is 3.8 MB and committed** (no `wasm-opt`, matching
  `yaak-templates`). It will churn on every model-layer change; a CI-built
  artifact is the real answer.
- **Settings opens in the same tab** and is left with the browser's Back button.
- **Settings shows Data Directory / Logs Directory rows** with empty values; the
  Create Workspace dialog offers directory sync and encryption. Should be gated
  on `localFiles` / `sync` / `encryption`.
- **`cmd_render_template` returns the template unrendered.** Resolving variables
  and calling template functions is plugin work.
- **A declined command logs an unhandled rejection** next to its toast — the
  app's own `createFastMutation.mutate`, same on desktop.
- **`yaak-rpc-schema` does not come to wasm** (it pulls the git/gRPC/plugin
  crates for their types), so the crate declares the handful of request shapes
  it needs locally, and `commands.ts` stays typed against `RpcSchema`.

## What slice 2 (the send proxy) will need from this layer

Sending becomes a stateless hosted service; this layer stays the only place data
lives. Concretely:

1. **A rendered request to send.** The client assembles `HttpSendInputs` and
   posts it. Nothing about the workspace is uploaded except what this request
   needs.
2. **Cookies out, cookies in.** The active `cookie_jar` model's `cookies` array
   goes up with the request; the proxy returns the jar as the exchange left it,
   and the client upserts it back through `models_upsert` like any other write.
   The proxy keeps nothing.
3. **A response body sink.** `blob_put(responseId, bytes)` in the worker
   writes through the desktop's `blob_manager`, chunked the way it chunks.
   Streaming will want an append path rather than one whole-body write.
4. **A request body sink** under `${responseId}.request`, which
   `cmd_http_request_body` already reads.
5. **Response and timeline models.** `cmd_send_http_request` currently declines;
   it will instead upsert an `http_response` as the exchange progresses, plus
   `http_response_event` rows once `timeline` becomes true. Both flow through
   the same `write()` helper, so other tabs see a send land live.
6. **Blob cleanup is the desktop's.** `delete_http_response` and
   `delete_workspace` in `yaak-models` already remove blob chunks.
