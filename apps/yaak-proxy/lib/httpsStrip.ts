import type { DecryptListEntry, Flow } from "@yaakapp-internal/proxy-lib";
import { decryptsAnything, entryMatches, isDecrypted } from "./decrypt";
import { connectionOf } from "./encryptedCard";
import { isSystemFlow, siteOf } from "./search";

/** What the strip above the list shows */
export type StripState =
  /** Not shown */
  | "hidden"
  /** HTTPS is encrypted, with Decrypt Everything and Choose… */
  | "offer"
  /** The list decrypts something and the certificate isn't trusted: Trust, however dismissed */
  | "broken";

export interface StripInput {
  list: DecryptListEntry[];
  /** Encrypted connections in the capture */
  encrypted: number;
  /** Its × was clicked, remembered */
  dismissed: boolean;
  /** The certificate is trusted, null until read */
  trusted: boolean | null;
  /** The app can trust the certificate itself, as on macOS */
  canTrust: boolean;
}

/**
 * Shows while nothing is decrypted and some HTTPS is encrypted, until dismissed; goes once
 * anything is on the list, from anywhere. A list that decrypts something while the certificate
 * isn't trusted is broken, and says so whatever else holds.
 */
export function stripState({
  list,
  encrypted,
  dismissed,
  trusted,
  canTrust,
}: StripInput): StripState {
  const listed = decryptsAnything(list);
  if (listed && canTrust && trusted === false) return "broken";
  if (listed || encrypted === 0 || dismissed) return "hidden";
  return "offer";
}

/** "22 connections" */
export function connectionCount(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "connection" : "connections"}`;
}

export interface ChooseApp {
  name: string;
  bundleId: string | null;
  path: string | null;
  count: number;
  checked: boolean;
}

export interface ChooseSite {
  site: string;
  count: number;
  checked: boolean;
}

/** At most this many apps, and sites, in Choose… */
const CHOOSE_MAX = 8;

/**
 * Choose…'s rows: the apps and sites of the encrypted connections seen, most connections first,
 * each checked while the list decrypts it. System's daemons and what a built-in exclusion keeps
 * out are left out, as decrypting those is deliberate, from the card or Settings.
 */
export function chooseOptions(
  flows: Pick<Flow, "url" | "tunnelled" | "clientName" | "clientBundleId" | "clientPath">[],
  list: DecryptListEntry[],
): { apps: ChooseApp[]; sites: ChooseSite[] } {
  const builtIns = list.filter((e) => e.builtIn && e.entry.startsWith("!"));
  const apps = new Map<string, ChooseApp>();
  const sites = new Map<string, ChooseSite>();
  for (const flow of flows) {
    if (!flow.tunnelled || isSystemFlow(flow)) continue;
    const c = connectionOf(flow);
    const q = { host: c.host, port: c.port, app: c.app };
    if (builtIns.some((e) => entryMatches(e.entry, q))) continue;
    if (c.app != null) {
      const app = apps.get(c.app.name) ?? {
        name: c.app.name,
        bundleId: c.app.bundleId,
        path: flow.clientPath,
        count: 0,
        checked: isDecrypted(list, { kind: "app", ...c.app }),
      };
      app.count++;
      apps.set(app.name, app);
    }
    const name = siteOf(c.label);
    const site = sites.get(name) ?? {
      site: name,
      count: 0,
      checked: isDecrypted(list, { kind: "site", site: name }),
    };
    site.count++;
    sites.set(name, site);
  }
  const top = <T extends { count: number }>(rows: Iterable<T>) =>
    [...rows].sort((a, b) => b.count - a.count).slice(0, CHOOSE_MAX);
  return { apps: top(apps.values()), sites: top(sites.values()) };
}
