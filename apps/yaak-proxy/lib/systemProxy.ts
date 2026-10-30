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
    const description = state.helper ? "Changing the system proxy" : "Waiting for your password";
    return { checked: state.pending, description, failed: false };
  }
  // A failed change leaves the switch where the system proxy actually is.
  const checked = state.routing;
  if (state.error != null) {
    const cancelled = /cancel/i.test(state.error);
    return {
      checked,
      description: cancelled ? "Cancelled in the password prompt" : state.error,
      failed: true,
    };
  }
  return {
    checked,
    description: checked
      ? "Routing this Mac's web traffic through Yaak Proxy"
      : `Not routing. Only apps pointed at port ${state.port ?? 9090} are captured`,
    failed: false,
  };
}

export interface HelperRow {
  title: string;
  /** Which way changes go, and why */
  description: string;
  /** What the row's button does, if it has one: the first two open the approval dialog */
  action: "install" | "approve" | "unregister" | null;
}

/** The privileged helper's row in the state pill menu, kept short */
export function helperRow(helper: HelperState, backend: SystemProxyBackend): HelperRow {
  switch (helper) {
    case "unavailable":
      return {
        title: "Helper: not in dev builds",
        description: "Changes use the password prompt.",
        action: null,
      };
    case "not_found":
      // What macOS reports until the helper is first installed.
      return {
        title: "Helper: not found by macOS",
        description: "Changes use the password prompt.",
        action: "install",
      };
    case "not_registered":
      return {
        title: "Helper: not installed",
        description: "Changes use the password prompt.",
        action: "install",
      };
    case "requires_approval":
      return {
        title: "Helper: awaiting approval",
        description: "Changes use the password prompt.",
        action: "approve",
      };
    case "enabled":
      return {
        title: "Helper: enabled",
        description:
          backend === "helper"
            ? "No password prompts."
            : "One more password prompt puts back your settings.",
        action: "unregister",
      };
    default: {
      // Every state is handled above; one this build doesn't know still gets a row, rather
      // than taking the whole menu down.
      const unknown: never = helper;
      return {
        title: `Helper: ${String(unknown)}`,
        description: "Changes use the password prompt.",
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
