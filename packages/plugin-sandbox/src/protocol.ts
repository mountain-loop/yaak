/**
 * Two request/reply flows in opposite directions. Payloads are JSON strings
 * rather than objects because they must be strings to cross into QuickJS
 * anyway, so structured-cloning them first would only be undone.
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
