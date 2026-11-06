/** What decides whether setup is done, as the app last read it */
export interface SetupState {
  /** The certificate is trusted, or null until read */
  trusted: boolean | null;
  /** The system proxy can be set on this platform, or null until read */
  systemProxySupported: boolean | null;
  /** The system proxy has been on at some point since this install */
  systemProxyEverOn: boolean;
}

/**
 * The first-run card shows while setup is incomplete: the certificate untrusted, or the system
 * proxy never on since this install, where there is one. Not while either is still being read,
 * so the card does not flash. Once setup is done an empty list is the "no flows yet" state,
 * after a Clear too.
 */
export function setupIncomplete(s: SetupState): boolean {
  if (s.trusted == null || s.systemProxySupported == null) return false;
  if (!s.trusted) return true;
  return s.systemProxySupported && !s.systemProxyEverOn;
}
