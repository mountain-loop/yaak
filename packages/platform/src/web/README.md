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
        │                   ◀── model_writes ──          crates/yaak-wasm → yaak-models → SQLite
        │                                                               └─ pages in IndexedDB
        └── send.ts ──POST rendered request──▶ yaak-web (crates-server) ──▶ the internet
                     ◀── NDJSON: events, response, body, cookies ──
```

| File | What it is |
| --- | --- |
| `index.ts` | The `Platform` implementation. |
| `commands.ts` | The command table: model commands forward to the worker; the rest is fixed answers and refusals-with-a-reason. |
| `connection.ts` | A tab's end of the wire: request/response over a `MessagePort`, event delivery, and the tab's identity (`label`). |
| `send.ts` | Sending: the worker renders (`prepare_http_send`), the server executes, this file stores what comes back where the desktop stores it. |
| `server.ts` | Where the Yaak server is, and the wire shapes it speaks (generated from `crates-server/yaak-web/src/wire.rs`). |
| `worker.ts` | The process that owns the database. Loads the wasm, opens the DB once, answers each port, fans `model_writes` out to every port. |
| `protocol.ts` | The message shapes both sides import. |
| `errors.ts` | `UnsupportedCommandError`, the structured refusal. |
| `storage.ts` | `navigator.storage.persist()`. |

The Rust side is `crates/yaak-wasm` (`@yaakapp-internal/wasm`): `boot()`,
`rpc(cmd, payload, label)` returning `{ result, events }`, blob get/put, and
`prepare_http_send(payload)` — the database half of a send (environment chain,
inherited headers and auth, request settings, cookie jar, rendering), which is
`yaak_models::render::render_http_request`, the same function the desktop
renders with.
Its `pkg/` is committed; rebuilding needs a clang with a WebAssembly backend
(`brew install llvm`), and `build-wasm.cjs` skips with a notice when there
isn't one, so a desktop `npm run bootstrap` never depends on it.

Behaviours worth knowing before changing anything:

- **The worker is a `SharedWorker`, and only that.** The browser hands every
  tab on the origin the same one, which is what makes "one database owner"
  true without anyone coordinating — and makes the browser look like the
  desktop: one process holds the data, every window talks to it, it pushes
  writes to all of them. It still takes a Web Lock before opening, for the one
  overlap the browser doesn't rule out (a reloading tab's dying predecessor).
  There is deliberately no fallback to a per-tab worker: two kinds of worker
  that can both come up is a race. Every current browser, desktop and mobile,
  has `SharedWorker` and Web Locks (Chrome for Android since 148, April 2026);
  older ones get a clear "unsupported browser" message rather than a second
  SQLite over the same pages.
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
32, declines 43 by name with a reason, and refuses the remaining 34 generically.

### Implemented (32)

| Group | Commands |
| --- | --- |
| Models | `models_workspace_models`, `models_upsert`, `models_delete`, `models_duplicate`, `models_get_settings`, `models_get_graphql_introspection`, `models_upsert_graphql_introspection`, `models_grpc_events`, `models_websocket_events` |
| Sending | `cmd_send_http_request` (through the Yaak server; see below) |
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

### Declined by name (43)

Each returns an `UnsupportedCommandError` carrying `cmd`, a user-facing
`message`, and the `capability` a caller should have checked. The UI turns it
into a toast.

| Reason | Commands |
| --- | --- |
| Sending, the parts not wired yet | `cmd_send_ephemeral_request`, `cmd_delete_send_history`, `cmd_delete_all_http_responses`, `cmd_import_url` |
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
| `httpSending`, `timeline`, `cookieJar` | `grpc`, `websocket`, `git`, `sync`, `tlsOptions`, `localFiles`, `multiWindow`, `windowChrome`, `interfaceZoom`, `plugins`, `encryption`, `updater`, `clipboardRead`, `systemFonts`, `license` |

`interfaceZoom: false` leaves Cmd/Ctrl `+`, `-` and `0` to the browser instead
of swallowing them, and drops those three rows from the hotkeys screen.

`multiWindow: false` means the host cannot open a *second window* on demand —
what `cmd_new_child_window` does for Settings and workspace switching. It is not
a claim that nothing else is looking: other tabs may well be open on the same
worker, and it pushes every write to all of them regardless.

`windowChrome: false` means the browser owns the frame around the page, so the
header draws no window controls and reserves no room for macOS traffic lights.

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

## Sending

A page cannot see a response the way a desktop app can — CORS exposes a handful
of headers, redirects are followed silently, there is no timeline — so the
network half of a send runs on a small stateless server,
`crates-server/yaak-web`. This layer stays the only place data lives:

1. `send.ts` creates the `http_response` row (state `initialized`), as the
   desktop does, so anything that goes wrong lands in the response pane.
2. The worker resolves and renders the request (`prepare_http_send`): the
   environment chain, inherited headers and auth, request settings, the cookie
   jar. This is the desktop's `HttpSendInputs`, in Rust, on the same model layer,
   with `yaak_models::render::render_http_request`. Variables (`${[ name ]}`)
   render here with no plugins involved.
3. The rendered request, the settings and the jar's cookies are POSTed to the
   server. It streams back timeline events, the response head, body chunks and a
   terminal frame carrying the jar as the send left it.
4. Each frame is written where the desktop writes it: the response row as it
   progresses, `http_response_event` rows for the timeline (which is why
   `timeline` is true), the body under the response id via `blob_put`, and the
   cookie jar through `models_upsert`. Every write fans out to every tab.

**What sends today:** any saved request whose templates are variables and whose
authentication is none, or an inline header. Sending a request that needs a
template *function* (`${[ timestamp() ]}`) or an authentication plugin (bearer,
basic, OAuth, …) is refused before anything leaves the tab, with a message naming
what it needs; those light up when plugins run in the browser. Requests with a
file body or multipart file fields are refused by the server (it has no access to
your files, and must not read its own). And on a public instance a request to
`localhost` or a LAN address can't work: the server runs elsewhere and refuses
private ranges outright — that is what the desktop app is for. A self-hosted
server on your own network can be started with `--allow-private-networks`, which
is the one case where those addresses are the user's to reach.

**Where the tab sends** (`server.ts`): a production build posts to `/v1/http/send`
on its own origin, because the server can serve the app itself
(`yaak-web --serve dist/apps/yaak-client`, which is what the
`ghcr.io/mountain-loop/yaak-web` image runs) — same origin, so no CORS and
nothing to configure. A dev build falls back to `http://127.0.0.1:9227`, since
the Vite server is a different origin and serves no `/v1`; run one with
`cargo run -p yaak-web`. `VITE_YAAK_WEB_URL` overrides both, for a
deployment that keeps the app and the server apart.
