/**
 * The messages that cross between a tab and the worker that owns the database.
 *
 * Declared once and imported from both sides, so a change to the shape is a
 * type error in whichever side forgot. Kept deliberately small: commands in,
 * results or errors out, and events pushed the other way — the same envelope
 * the desktop's IPC uses, because that is what the frontend is written against.
 */

/** Tab → worker */
export type ToWorker =
  | { type: "rpc"; id: number; cmd: string; payload: unknown; label: string }
  | { type: "blob_get"; id: number; blobId: string }
  | { type: "blob_put"; id: number; blobId: string; bytes: ArrayBuffer }
  | { type: "blob_delete"; id: number; blobId: string }
  /** The tab is going away; the worker can forget its port. */
  | { type: "goodbye" };

/** Worker → tab */
export type FromWorker =
  /**
   * Sent synchronously the moment a port connects, before anything else. Its
   * only job is to prove the worker is alive: a tab that connects during a
   * shared worker's teardown gets a port that is accepted and then never
   * serviced, and this is how it tells that apart from a slow boot.
   */
  | { type: "hello" }
  /** The database is open. Sent to each port once boot has finished. */
  | { type: "ready" }
  /** The database could not be opened; every command will fail with this. */
  | { type: "boot_error"; message: string }
  | { type: "result"; id: number; result: unknown }
  | { type: "error"; id: number; message: string }
  /** A backend event for the app — today only `model_writes`. Sent to every port. */
  | { type: "event"; event: string; payload: unknown };

/** What the worker registers itself under. Tabs on one origin share it. */
export const WORKER_NAME = "yaak-db";

/**
 * The Web Lock every worker takes before opening the database, shared or not.
 *
 * A SharedWorker is the *preferred* owner because the browser gives all tabs
 * the same one — but it is not the *guarantee*. A tab that gave up waiting for
 * a slow shared worker and fell back to a dedicated one must not find the
 * shared worker starting up behind it and opening a second SQLite over the
 * same pages. The lock is what makes "one database owner per origin" true no
 * matter how the workers arrived.
 */
export const DB_LOCK_NAME = "yaak-db";
