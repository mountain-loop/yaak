import type { DecryptListEntry, Flow } from "@yaakapp-internal/proxy-lib";
import {
  type DecryptQuery,
  type DecryptSubject,
  decrypts,
  decryptsAnything,
  detailActions,
  EVERYTHING,
  entryMatches,
  entrySubject,
  listEdit,
  setDecrypted,
  subjectEntry,
} from "./decrypt";
import { hostnameOf } from "./search";

/** Where an encrypted connection went, and the app that opened it, as the list judges it */
export interface Connection {
  /** The host alone, an IPv6 address without brackets */
  host: string;
  port: number;
  /** The host as a button names it: with its port when that is not 443 */
  label: string;
  /** `host:port`, an IPv6 host in brackets, as the engine's pass-through set lists it */
  address: string;
  app: { name: string; bundleId: string | null } | null;
}

type ConnectionFlow = Pick<Flow, "url" | "clientName" | "clientBundleId">;

/** The connection a tunnel or a refused handshake records: `https://host:port` or `host:port` */
export function connectionOf(flow: ConnectionFlow): Connection {
  const scheme = flow.url.indexOf("://");
  const rest = scheme === -1 ? flow.url : flow.url.slice(scheme + 3);
  const authority = (rest.split(/[/?#]/)[0] ?? "").toLowerCase();
  const name = hostnameOf(authority);
  const portText = authority.slice(name.length + 1);
  const port = /^\d+$/.test(portText) ? Number(portText) : 443;
  const host = name.replace(/^\[|\]$/g, "");
  return {
    host,
    port,
    label: port === 443 ? name : `${name}:${port}`,
    address: `${name}:${port}`,
    app: flow.clientName == null ? null : { name: flow.clientName, bundleId: flow.clientBundleId },
  };
}

function queryOf(c: Connection): DecryptQuery {
  return { host: c.host, port: c.port, app: c.app };
}

/** What a button on the card does */
export type CardActionKind =
  | "decrypt"
  | "stop"
  | "reconnect"
  | "trust"
  | "try_again"
  | "copy_environment";

export interface CardAction {
  kind: CardActionKind;
  label: string;
  /** What it writes, shown beside it: an entry, or a hint like `next connection` */
  hint: string | null;
  /** The hint is an entry it takes off the list, so it is struck through */
  removes?: boolean;
  /** The list change, for `decrypt` and `stop` */
  edit?: { add: string[]; remove: string[] };
  /** What the toast says was chosen */
  toast?: { message: string; sub?: string };
  /** The suggested action */
  primary?: boolean;
  /** The narrowest override of an exclusion that ships for a reason */
  dashed?: boolean;
  /** What the icon shows: a host, the app, everything, or the action's own */
  icon: "host" | "app" | "everything" | "lock" | "lock_open" | "refresh" | "shield" | "terminal";
}

/**
 * A line of text, the hosts, apps and entries in it shown as code, as Yaak shows literal values,
 * and a lead in bold
 */
export type Line = (string | { code: string } | { bold: string })[];

/** A line as plain text, its code in backticks and its bold in asterisks */
export function lineText(line: Line): string {
  return line
    .map((part) =>
      typeof part === "string" ? part : "code" in part ? `\`${part.code}\`` : `**${part.bold}**`,
    )
    .join("");
}

export interface EncryptedCardModel {
  rejected: boolean;
  /** Why the connection is encrypted, in one sentence */
  why: Line;
  /** What the info button beside it says, in place of the general line; null for that line */
  tooltip: string | null;
  actions: CardAction[];
  /** Small lines under the buttons */
  foot: string[];
}

export interface EncryptedCardInput {
  flow: Pick<
    Flow,
    | "url"
    | "clientName"
    | "clientBundleId"
    | "clientPath"
    | "tunnelReason"
    | "tunnelExcludedBy"
    | "tunnelExcludedBuiltIn"
    | "tlsRejected"
    | "elapsedMs"
    | "error"
  >;
  list: DecryptListEntry[];
  /** The certificate is trusted, null until read */
  trusted: boolean | null;
  /** The app can trust the certificate itself, as on macOS */
  canTrust: boolean;
  /** The addresses passed through after a rejection, null until read */
  passthrough: string[] | null;
  /** For a tunnel passed through after a rejection: the client that refused, when known */
  rejectedBy?: Pick<Flow, "clientName" | "clientBundleId" | "clientPath"> | null;
}

/** A refused handshake, or a tunnel passed through because of one */
export function isRejection(flow: Pick<Flow, "tlsRejected" | "tunnelReason">): boolean {
  return flow.tlsRejected != null || flow.tunnelReason === "rejected";
}

/** A tunnel still open: written as it opens, done once it closes */
export function isOpen(flow: Pick<Flow, "elapsedMs" | "error">): boolean {
  return flow.elapsedMs == null && flow.error == null;
}

/**
 * The card for an HTTPS connection the proxy did not decrypt: why, from what the engine recorded
 * as it opened, and the changes to the list that would decrypt the next one like it, judged
 * against the list as it is now. Once the list decrypts it, the card says it opened before and
 * offers the opposite, and Reconnect while it is open. Nothing on it narrates what happens next.
 */
export function encryptedCard(input: EncryptedCardInput): EncryptedCardModel {
  return isRejection(input.flow) ? rejectedCard(input) : tunnelCard(input);
}

function tunnelCard({ flow, list, trusted, canTrust }: EncryptedCardInput): EncryptedCardModel {
  const c = connectionOf(flow);
  const q = queryOf(c);
  const decryptsNow = decrypts(list, q);
  const foot: string[] = [];

  if (decryptsNow) {
    // Decrypted from the next connection on: the entries that do it, each to take back.
    const decrypting = list.filter(
      (e) => !e.builtIn && !e.entry.startsWith("!") && entryMatches(e.entry, q),
    );
    const actions: CardAction[] = decrypting.map((e) => stopEntry(e.entry));
    if (isOpen(flow)) {
      actions.unshift({ kind: "reconnect", label: "Reconnect", hint: null, icon: "refresh" });
    }
    const first = decrypting[0]?.entry;
    const what: Line[number] =
      first === EVERYTHING ? "everything" : { code: first == null ? c.label : entrySubject(first) };
    return {
      rejected: false,
      why: ["This connection was opened before ", what, " was decrypted."],
      tooltip: null,
      actions,
      foot: [],
    };
  }

  const actions: CardAction[] = [];
  const builtInBlock = list.find(
    (e) => e.builtIn && e.entry.startsWith("!") && entryMatches(e.entry, q),
  );
  const hostSubject: DecryptSubject = { kind: "host", host: c.label };
  const judged = detailActions(list, c.label, c.app);
  if (builtInBlock != null) {
    // Kept out by default for a reason: only the host itself, the narrowest override.
    if (judged.host) {
      actions.push({ ...decryptSubject(list, hostSubject, c.label, "host"), dashed: true });
      foot.length = 0;
      foot.push(
        builtInBlock.kind === "apple" || c.app == null
          ? "macOS may reject the connection."
          : `${c.app.name} may reject the connection.`,
      );
    }
  } else {
    if (judged.host) actions.push(decryptSubject(list, hostSubject, c.label, "host"));
    if (judged.app && c.app != null) {
      actions.push(decryptSubject(list, { kind: "app", ...c.app }, c.app.name, "app"));
    }
    const everything = list.some((e) => e.entry === EVERYTHING);
    if (!everything && decrypts([{ entry: EVERYTHING, builtIn: false }, ...list], q)) {
      actions.push({
        kind: "decrypt",
        label: "Decrypt Everything",
        hint: EVERYTHING,
        edit: { add: [EVERYTHING], remove: [] },
        toast: { message: "Decrypting everything", sub: "Excluded hosts and apps stay encrypted." },
        icon: "everything",
      });
    }
    if (actions.length === 0) {
      // The person's own exclusions keep it out: taking them off, when that alone decrypts it.
      const own = list.filter(
        (e) => !e.builtIn && e.entry.startsWith("!") && entryMatches(e.entry, q),
      );
      const without = list.filter((e) => !own.includes(e));
      if (own.length > 0 && decrypts(without, q)) {
        const [only] = own;
        const label =
          own.length === 1 && only != null
            ? `Stop Excluding ${entrySubject(only.entry.slice(1))}`
            : `Stop Excluding ${own.length} Entries`;
        actions.push({
          kind: "decrypt",
          label,
          hint: own.map((e) => e.entry).join(", "),
          removes: true,
          edit: { add: [], remove: own.map((e) => e.entry) },
          toast: { message: label.replace("Stop Excluding", "Stopped excluding") },
          icon: "lock_open",
        });
      }
    }
  }
  if (actions.length > 0 && canTrust && trusted === false) {
    foot.push("macOS will ask for a password once.");
  }
  return {
    rejected: false,
    why: whyLine(flow, list, c),
    tooltip: null,
    actions,
    foot: actions.length === 0 ? [] : foot,
  };
}

/**
 * The why line of a connection the list does not decrypt, from the reason the engine recorded
 * as the tunnel opened: what excluded it, or, with nothing to exclude it, its host.
 */
function whyLine(flow: EncryptedCardInput["flow"], list: DecryptListEntry[], c: Connection): Line {
  if (flow.tunnelReason === "excluded" && flow.tunnelExcludedBy != null) {
    if (flow.tunnelExcludedBuiltIn) {
      const kind = list.find((e) => e.entry === flow.tunnelExcludedBy)?.kind;
      return [
        kind === "apple"
          ? "Apple services are excluded by default."
          : kind === "pinned"
            ? "Apps that pin certificates are excluded by default."
            : "This connection is excluded by default.",
      ];
    }
    return ["This connection is excluded by ", { code: flow.tunnelExcludedBy }, "."];
  }
  return [
    { bold: "Encrypted Content:" },
    " Enable decryption to see requests to ",
    { code: c.label },
  ];
}

function decryptSubject(
  list: DecryptListEntry[],
  subject: DecryptSubject,
  name: string,
  icon: CardAction["icon"],
): CardAction {
  return {
    kind: "decrypt",
    label: `Decrypt ${name}`,
    hint: subjectEntry(subject),
    edit: listEdit(list, setDecrypted(list, [subject], true)),
    toast: { message: `Decrypting ${name}` },
    icon,
  };
}

function stopEntry(entry: string): CardAction {
  const name = entrySubject(entry);
  return {
    kind: "stop",
    label: `Stop Decrypting ${name}`,
    hint: entry,
    removes: true,
    edit: { add: [], remove: [entry] },
    toast: { message: `Stopped decrypting ${entry === EVERYTHING ? "everything" : name}` },
    icon: "lock",
  };
}

/**
 * Stop Decrypting on a refused connection, judged with its host, port and app together: takes
 * off the person's entry naming exactly this host when that alone stops it, else excludes the
 * app when it is known, else the host, which the list always honours. Null when the list does
 * not decrypt it.
 */
export function stopDecryptingConnection(
  list: DecryptListEntry[],
  connection: Connection,
): CardAction | null {
  const q = queryOf(connection);
  if (!decrypts(list, q)) return null;
  const hostEntry = subjectEntry({ kind: "host", host: connection.label });
  const own = list.find((e) => !e.builtIn && e.entry === hostEntry);
  if (
    own != null &&
    !decrypts(
      list.filter((e) => e !== own),
      q,
    )
  ) {
    return { ...stopEntry(own.entry), label: `Stop Decrypting ${connection.label}` };
  }
  const name = connection.app?.name ?? connection.label;
  const add = connection.app == null ? `!${hostEntry}` : `!app:${connection.app.name}`;
  return {
    kind: "stop",
    label: `Stop Decrypting ${name}`,
    hint: add,
    edit: { add: [add], remove: [] },
    toast: { message: `Stopped decrypting ${name}` },
    icon: "lock",
  };
}

/** Who refused: an app with a bundle, a program without one, or a client the app couldn't name */
type Refuser =
  | { kind: "app"; name: string }
  | { kind: "program"; name: string }
  | { kind: "unknown" };

function refuserOf(
  client: Pick<Flow, "clientName" | "clientBundleId" | "clientPath"> | null | undefined,
): Refuser {
  if (client?.clientName == null) return { kind: "unknown" };
  if (client.clientBundleId != null) return { kind: "app", name: client.clientName };
  return { kind: "program", name: client.clientName };
}

function rejectedCard(input: EncryptedCardInput): EncryptedCardModel {
  const { flow, list, trusted, canTrust, passthrough } = input;
  const c = connectionOf(flow);
  // The refused handshake names its own client; a tunnel after it, the one that refused.
  const own = flow.tlsRejected != null;
  const refuser = refuserOf(own ? flow : input.rejectedBy);
  const stop = stopDecryptingConnection(list, c);
  const passedThrough = passthrough == null ? null : passthrough.includes(c.address);
  const tryAgain: CardAction | null =
    passedThrough === false
      ? null
      : { kind: "try_again", label: "Retry", hint: "next connection", icon: "refresh" };
  // No longer passed through: the next connection is decrypted while the list still decrypts
  // it. Excluded since, it stays encrypted, and there is nothing to add.
  const until: string[] | null =
    passedThrough === false
      ? stop == null
        ? []
        : ["The next connection will be decrypted."]
      : null;

  if (canTrust && trusted === false && decryptsAnything(list)) {
    return {
      rejected: true,
      why: ["The certificate is not trusted."],
      tooltip: null,
      actions: [
        { kind: "trust", label: "Trust Certificate", hint: null, primary: true, icon: "shield" },
        ...(stop == null ? [] : [stop]),
      ],
      // Whether or not it is still passed through: untrusted, the next one is rejected too.
      foot: ["This host stays encrypted until the certificate is trusted."],
    };
  }

  const forHost = own ? "" : " for this host";
  if (refuser.kind === "program") {
    return {
      rejected: true,
      why: [`${refuser.name} rejected the certificate${forHost}.`],
      tooltip: `${refuser.name} uses its own trust store, so it does not trust the certificate.`,
      actions: [
        {
          kind: "copy_environment",
          label: "Copy Environment",
          hint: "SSL_CERT_FILE, …",
          primary: true,
          icon: "terminal",
        },
        ...(stop == null ? [] : [stop]),
        ...(tryAgain == null ? [] : [tryAgain]),
      ],
      foot: until ?? [`Paste it into a terminal, then rerun ${refuser.name}.`],
    };
  }
  return {
    rejected: true,
    why: [
      refuser.kind === "app"
        ? `${refuser.name} rejected the certificate${forHost}.`
        : "An app rejected the certificate.",
    ],
    tooltip:
      refuser.kind === "app"
        ? `${refuser.name} likely pins its certificate, so it cannot be decrypted.`
        : null,
    actions: [
      ...(stop == null ? [] : [{ ...stop, primary: true }]),
      ...(tryAgain == null ? [] : [tryAgain]),
    ],
    foot: until ?? ["This host stays encrypted until Yaak Proxy is relaunched."],
  };
}
