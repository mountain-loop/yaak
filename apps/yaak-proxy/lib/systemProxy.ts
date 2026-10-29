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
  /** What the row's button does, if it has one */
  action: "install" | "open_settings" | "unregister" | null;
}

/** The privileged helper's row in the state pill menu */
export function helperRow(helper: HelperState, backend: SystemProxyBackend): HelperRow {
  switch (helper) {
    case "unavailable":
      return {
        title: "Helper: not available in dev builds",
        description: "Only the installed app can run it, so changes use the password prompt.",
        action: null,
      };
    case "not_found":
      return {
        title: "Helper: macOS can't find the helper in this app bundle",
        description:
          "macOS says this until the helper is first installed. Changes use the password prompt until then.",
        action: "install",
      };
    case "not_registered":
      return {
        title: "Helper: not installed",
        description:
          "Changes use the password prompt. Install the helper to change the system proxy without one.",
        action: "install",
      };
    case "requires_approval":
      return {
        title: "Helper: awaiting approval in System Settings",
        description:
          "Allow Yaak Proxy under General > Login Items & Extensions. Until then, changes use the password prompt.",
        action: "open_settings",
      };
    case "enabled":
      return {
        title: "Helper: enabled",
        description:
          backend === "helper"
            ? "Changes need no password, and your own proxy settings come back when Yaak Proxy quits or crashes."
            : "The password prompt puts back the settings it saved once more, then the helper takes over.",
        action: "unregister",
      };
  }
}

/** The menu item that pauses or resumes storing flows */
export function recordingLabel(recording: boolean): string {
  return recording ? "Pause Recording" : "Resume Recording";
}
