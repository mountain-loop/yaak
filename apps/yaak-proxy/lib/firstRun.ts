import type { DecryptListEntry } from "@yaakapp-internal/proxy-lib";
import { decryptsEverything } from "./decrypt";

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

/** The first-run card's "Choose what to decrypt" step, as the decrypt list has it */
export interface DecryptStep {
  /** Everything is decrypted, `*` on the list; else hosts are picked as they appear */
  choice: "everything" | "pick";
  state: "todo" | "next" | "done";
}

/**
 * Picking hosts as they appear is the default and needs nothing done, so the step waits on the
 * certificate like the others and is done once a choice is on the list: everything, or any host
 * or app picked already.
 */
export function decryptStep(list: DecryptListEntry[], trusted: boolean): DecryptStep {
  const choice = decryptsEverything(list) ? "everything" : "pick";
  const picked = list.some((e) => !e.builtIn && !e.entry.startsWith("!"));
  return { choice, state: picked ? "done" : trusted ? "next" : "todo" };
}
