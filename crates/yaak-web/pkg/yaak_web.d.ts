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
 * Run one command as `label` (the calling tab's identity, which stands in for
 * the desktop's window label on every write it makes).
 *
 * The payload shapes match the `Cmd*Req` types in `yaak-rpc-schema` — that
 * crate itself pulls the git, gRPC and plugin crates for their response types
 * and cannot come to wasm, so the handful needed here are declared locally.
 */
export function rpc(cmd: string, payload: any, label: string): any;
