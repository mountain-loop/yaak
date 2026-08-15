# Yaak Bridge

A headless binary that runs the real Yaak engine for a browser tab.

The tab is the unmodified Yaak UI. Everything a page cannot do — send an HTTP
request and see every response header, follow redirects, keep a cookie jar, run
the plugin runtime, read a response body off disk — happens in this process,
reached over local HTTP and a WebSocket.

This is the reason a browser Yaak can be credible at all. An in-page `fetch`
sender only ever sees the CORS-safelisted response headers: measured against
httpbin, a server that sent 8 headers yielded 2. Through the bridge the same
request yields all 8, plus the redirect chain, `Set-Cookie`, connection timings
and client certificates.

## Running it

Start the bridge:

```bash
cargo run -p yaak-server -- --port 9444
```

It binds `127.0.0.1` only and prints a bearer token that every route requires.

Then point a frontend at it. In dev, run Vite separately and tell it where the
bridge is:

```bash
YAAK_CLIENT_DEV_PORT=1472 VITE_YAAK_BRIDGE_URL=http://127.0.0.1:9444 npm run dev --workspace apps/yaak-client
```

Open `http://localhost:1472/?bridgeToken=<token>`. The token is consumed from
the query, kept for the session, and stripped from the address bar. Without one
you get a small connect form.

To serve the built frontend from the bridge itself instead, so there is only one
process:

```bash
npm run build --workspace apps/yaak-client
cargo run -p yaak-server -- --web-dir dist/apps/yaak-client
```

## Shape

| Route | What it carries |
| --- | --- |
| `POST /rpc` | The yaak-rpc envelope, the same one Tauri's `invoke` wraps on the desktop |
| `GET /events` | WebSocket. Server to client: `model_writes`, `stream_{id}`, toasts, plugin events. Client to server: the tab's location, and replies to prompts |
| `GET /responses/:id/body` | Response bodies, with Range support. Replaces reading `bodyPath` off disk |
| `GET /bridge/info` | Capabilities and the implemented command list |

Auth is a bearer token in the `Authorization` header, or a `token` query
parameter for the two requests the browser issues itself (the WebSocket, and
`<img src>`-style body loads). It is dev-grade and deliberately minimal: OTP
pairing and request encryption replace it, and `require_token` in `http.rs` is
where they go.

## Relationship to the other hosts

The engine crates under `crates/` are Tauri-free, and `crates-cli/yaak-cli`
already proved they run headless. This crate is structurally the CLI's
`CliContext` with an event hub attached — same `init_standalone` database, same
`PluginManager` over the same Node sidecar.

Two things are ported deliberately rather than invented:

- **Model writes** (`model_writes.rs`) keep the desktop's two paths: an
  in-memory channel for writes this process made, and a poll of the
  `model_changes` table so external writers — the CLI, the desktop app open on
  the same database — show up live in the browser.
- **Plugin host requests** (`plugin_events.rs`) let `yaak::plugin_events`
  answer everything that is only a database question, exactly as the CLI and the
  desktop do. Only the host-specific arms differ, and where the CLI answers a
  prompt from a TTY, the bridge round-trips it to the tab the way the desktop
  round-trips it to a window.

## Known gaps

- **Settings is unreachable.** The desktop opens it via `cmd_new_child_window`.
  A tab is one window, `multiWindow` is false, and this task did not add in-page
  routing for it.
- **One tab at a time.** Model writes broadcast correctly to every connected
  tab, so two tabs stay in sync for reads. What breaks is the session: the
  tab's reported URL lives in a single slot, so with two tabs in different
  workspaces a plugin's template render resolves against whichever attached
  last. Prompts also broadcast, so a dialog raised by one tab appears in both.
- **No local files.** There is no file dialog, so request bodies from disk,
  export, and save-response are unsupported. `cmd_import_data` is registered and
  works, but only for a path typed by hand on the bridge's machine.
- **Command subset.** Roughly 40 of the desktop's 107 commands are implemented.
  The rest return a structured "not supported on this host" error naming the
  command; `UNSUPPORTED_COMMANDS` in `rpc/mod.rs` lists them.
