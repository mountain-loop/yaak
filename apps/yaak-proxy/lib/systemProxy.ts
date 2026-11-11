import type { HelperState, SystemProxyBackend } from "@yaakapp-internal/proxy-lib";

/**
 * "Override system proxy": this Mac's web traffic pointed at the running engine, changed at once
 * whenever it is flipped, through the privileged helper or the macOS password prompt. Whether it
 * turns on as the app launches is a separate setting.
 */
export interface SystemProxyState {
  /** This Mac's web traffic points at the engine now */
  routing: boolean;
  /** The port apps can be pointed at by hand */
  port: number | null;
  /** A change is in flight, to this value */
  pending: boolean | null;
  /** The last change failed, with this message */
  error: string | null;
  /** Changes go through the helper, with no password prompt */
  helper?: boolean;
}

export interface SystemProxySwitch {
  checked: boolean;
  description: string;
  /** The description reports a failure */
  failed: boolean;
}

/** What the system proxy switch shows */
export function systemProxySwitch(state: SystemProxyState): SystemProxySwitch {
  if (state.pending != null) {
    const description = state.helper ? "Changing the system proxy" : "Waiting for macOS";
    return { checked: state.pending, description, failed: false };
  }
  // A failed change leaves the switch where the system proxy actually is.
  const checked = state.routing;
  if (state.error != null) {
    const cancelled = /cancel/i.test(state.error);
    return {
      checked,
      description: cancelled ? "The password prompt was cancelled." : state.error,
      failed: true,
    };
  }
  return {
    checked,
    description: checked
      ? "Traffic from every app will be recorded."
      : `Only traffic sent to port ${state.port ?? 9090} will be recorded.`,
    failed: false,
  };
}

export interface HelperRow {
  /** The helper's state, in one sentence */
  description: string;
  /** What the helper is for, or what this state still needs, behind the row's info icon */
  tooltip: string;
  /** What the row's button does, if it has one: the first two open the approval dialog */
  action: "install" | "approve" | "unregister" | null;
}

/** What the helper is for, the same in every state but one */
const HELPER_TOOLTIP = "The helper changes the system proxy without a password prompt.";

/** The privileged helper's row in Settings, kept short */
export function helperRow(helper: HelperState, backend: SystemProxyBackend): HelperRow {
  switch (helper) {
    case "unavailable":
      return {
        description: "The helper is not available in dev builds.",
        tooltip: HELPER_TOOLTIP,
        action: null,
      };
    case "not_found":
      // What macOS reports until the helper is first installed.
      return {
        description: "macOS could not find the helper.",
        tooltip: HELPER_TOOLTIP,
        action: "install",
      };
    case "not_registered":
      return {
        description: "The helper is not installed.",
        tooltip: HELPER_TOOLTIP,
        action: "install",
      };
    case "requires_approval":
      return {
        description: "The helper is awaiting approval.",
        tooltip: HELPER_TOOLTIP,
        action: "approve",
      };
    case "enabled":
      return {
        description: "The helper is installed.",
        tooltip:
          backend === "helper"
            ? HELPER_TOOLTIP
            : "One more password prompt is needed to restore the system proxy settings.",
        action: "unregister",
      };
    default: {
      // Every state is handled above; one this build doesn't know still gets a row, rather
      // than taking the whole page down.
      const unknown: never = helper;
      return {
        description: `The helper is ${String(unknown)}.`,
        tooltip: HELPER_TOOLTIP,
        action: null,
      };
    }
  }
}

/** How often the helper's state is read while it can change outside the app */
export const HELPER_POLL_MS = 2000;

/** How long after registering the state is read even before it shows approval pending */
export const HELPER_REGISTER_POLL_MS = 10_000;

/**
 * The interval to read the helper's state at: while it awaits approval in System Settings, and
 * briefly after registering, until it settles as enabled or not registered. Never otherwise.
 */
export function helperPollInterval(
  helper: HelperState | undefined,
  registeredAt: number | null,
  now: number,
): number | false {
  if (helper === "requires_approval") return HELPER_POLL_MS;
  if (helper === "enabled" || helper === "not_registered") return false;
  const justRegistered = registeredAt != null && now - registeredAt < HELPER_REGISTER_POLL_MS;
  return justRegistered ? HELPER_POLL_MS : false;
}

/** The menu item that pauses or resumes storing flows */
export function recordingLabel(recording: boolean): string {
  return recording ? "Pause Recording" : "Resume Recording";
}
