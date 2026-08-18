/**
 * The messages between a tab and its sandbox worker.
 *
 * Two request/reply flows in opposite directions. The tab asks the worker to
 * load a module or send it an event; the worker asks the tab to answer a
 * plugin's `ctx` call, because the tab is the only side with a database, a
 * network and a user. Both carry payloads as JSON strings rather than objects:
 * they have to be strings to cross into QuickJS anyway, and serializing once at
 * the edge is cheaper than structured-cloning an object the worker will only
 * stringify again.
 */

/** Tab → worker */
export type ToSandbox =
  | { type: "load"; id: number; pluginRefId: string; source: string }
  | { type: "unload"; id: number; pluginRefId: string }
  | { type: "dispatch"; id: number; pluginRefId: string; envelope: string }
  /** The tab's answer to a `host_call`. */
  | { type: "host_result"; id: number; reply?: string; error?: string };

/** Worker → tab */
export type FromSandbox =
  | { type: "result"; id: number; result: unknown }
  | { type: "error"; id: number; message: string }
  /** A plugin wants something only the tab can provide. */
  | { type: "host_call"; id: number; envelope: string }
  | { type: "log"; pluginRefId: string; level: string; message: string };
