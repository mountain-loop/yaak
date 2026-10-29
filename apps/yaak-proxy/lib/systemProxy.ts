/**
 * "Override system proxy": this Mac's web traffic pointed at the running engine, changed at once
 * whenever it is flipped, through the macOS password prompt. Whether it turns on as the app
 * launches is a separate setting.
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
    return { checked: state.pending, description: "Waiting for your password", failed: false };
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

/** The menu item that pauses or resumes storing flows */
export function recordingLabel(recording: boolean): string {
  return recording ? "Pause Recording" : "Resume Recording";
}
