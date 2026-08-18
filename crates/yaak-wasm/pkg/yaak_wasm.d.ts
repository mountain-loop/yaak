/* tslint:disable */
/* eslint-disable */

export function blob_delete(id: string): void;

/**
 * The bytes stored under an id, or none. Ids are the desktop's: a response's
 * own id for its body, `{responseId}.request` for the request that produced
 * it. Bytes cross to JS as a `Uint8Array` rather than through JSON.
 */
export function blob_get(id: string): Uint8Array | undefined;

/**
 * Store bytes under an id, replacing anything already there. Chunked the way
 * the desktop chunks, so a body written here reads back on a desktop that
 * imports the database, and vice versa.
 */
export function blob_put(id: string, bytes: Uint8Array): void;

/**
 * Register the IndexedDB-backed VFS and open the database.
 *
 * Migrations run inside `init_standalone`, exactly as they do for the CLI.
 * Safe to call more than once; later calls are no-ops.
 */
export function boot(): Promise<void>;

/**
 * Resolve and render a request for sending, exactly as the desktop does before it puts the
 * request on the network: the environment chain, inherited headers and auth, request
 * settings, the cookie jar. Nothing here touches a socket. What comes back is what the tab
 * posts to the Yaak server.
 *
 * `plugins` is the template function bridge — a JavaScript function taking a name and its
 * JSON arguments and resolving to the rendered string. Passing nothing is allowed and makes
 * every template function a refusal naming it.
 *
 * Authentication is *not* applied here even though it is part of preparing a send. It is
 * applied to the rendered request by the caller, because the plugin that applies it wants to
 * see the request as it will be sent, and the caller is the side that knows that.
 */
export function prepare_http_send(payload: any, plugins: any): Promise<any>;

/**
 * Render one template string against an environment chain.
 *
 * What `cmd_render_template` does on the desktop, for the same callers: the value previews
 * under an editor, and anywhere the app shows what a template will become. `ignore_error`
 * picks the same behaviour it picks there — a preview shows an empty string where a send
 * would refuse, because a half-typed template is not yet a mistake.
 */
export function render_template(payload: any, plugins: any): Promise<any>;

/**
 * Run one command as `label` (the calling tab's identity, which stands in for
 * the desktop's window label on every write it makes).
 *
 * The payload shapes match the `Cmd*Req` types in `yaak-rpc-schema`, but are
 * declared locally and dispatched by name, which is the one place this host
 * does not share the desktop's guarantees: the desktop builds its router from
 * the schema, so every command has a handler by construction. Here a renamed
 * command would surface as a runtime "not a command this host answers".
 *
 * The fix is `yaak-commands` (the `Host` trait), not more machinery here —
 * its `models::*` handlers are already this file, typed. Three things have to
 * give before a wasm host can register them:
 *
 * 1. `Host: Send + Sync`, which a browser cannot satisfy: there is one thread
 *    and the connection pool is an `Rc`.
 * 2. `models_delete` reaches for `spawn_blocking`; there is nothing to spawn
 *    onto here.
 * 3. `yaak-commands` depends on `yaak` and `yaak-plugins`, which pull the HTTP
 *    stack and the Node sidecar and do not build for wasm32.
 *
 * None of those are hard; they are just not this PR.
 */
export function rpc(cmd: string, payload: any, label: string): any;
