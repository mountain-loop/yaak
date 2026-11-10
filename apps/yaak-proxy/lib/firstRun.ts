/** What decides whether setup is done, as the app last read it */
export interface SetupState {
  /** The system proxy can be set on this platform, or null until read */
  systemProxySupported: boolean | null;
  /** The system proxy has been on at some point since this install */
  systemProxyEverOn: boolean;
}

/**
 * The first-run card shows while setup is incomplete: the system proxy never on since this
 * install, where there is one. The certificate is not part of it: nothing needs it until
 * something is decrypted, which asks for it then. Not while the system proxy is still being
 * read, so the card does not flash. Once setup is done an empty list is the "no flows yet"
 * state, after a Clear too.
 */
export function setupIncomplete(s: SetupState): boolean {
  if (s.systemProxySupported == null) return false;
  return s.systemProxySupported && !s.systemProxyEverOn;
}
