// The desktop's model layer, compiled to wasm for the browser. See src/lib.rs.
//
// This is loaded by the SharedWorker in packages/platform/src/web/worker.ts and
// nowhere else: it owns a SQLite database, and there must be exactly one of it
// per origin.
export { blob_delete, blob_get, blob_put, boot, prepare_http_send, rpc } from "./pkg";
