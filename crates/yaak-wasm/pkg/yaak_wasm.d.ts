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
 * Refuses, with a message the user can act on, when the request needs something this host
 * doesn't have: an authentication plugin, or a template function.
 */
export function prepare_http_send(payload: any): Promise<any>;

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
