import type { GetProxyStateResponse } from "@yaakapp-internal/proxy-lib";

/**
 * What the engine is doing, as the header shows it: the pill's dot and the header's tint both
 * read this, so they can't disagree.
 */
export type ProxyStatusKind = "recording" | "paused" | "cli" | "stopped" | "encrypting";

/** The status of a proxy state, or null while it hasn't been read yet */
export function proxyStatusOf(
  state: GetProxyStateResponse | null | undefined,
): ProxyStatusKind | null {
  if (state == null) return null;
  // Traffic stored before encryption is being encrypted; the engine starts once it is.
  if (state.state !== "running" && state.otherOwner == null && state.encrypting != null) {
    return "encrypting";
  }
  if (state.otherOwner != null) return "cli";
  if (state.locked != null || state.state !== "running") return "stopped";
  return state.recording === false ? "paused" : "recording";
}

/** The header's tint for a status, from the theme's colours; null for none */
export function statusTintColor(status: ProxyStatusKind | null): string | null {
  switch (status) {
    case "recording":
      return "var(--success)";
    case "paused":
      return "var(--warning)";
    case "stopped":
      return "var(--danger)";
    case "cli":
      return "var(--info)";
    default:
      return null;
  }
}
