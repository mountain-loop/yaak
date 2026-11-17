import type { DecryptListEntry } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import {
  connectionOf,
  type EncryptedCardInput,
  encryptedCard,
  lineText,
  stopDecryptingConnection,
} from "./encryptedCard";

const user = (...entries: string[]): DecryptListEntry[] =>
  entries.map((entry) => ({ entry, builtIn: false }));
const BUILT_INS: DecryptListEntry[] = [
  { entry: "!host:*.apple.com", builtIn: true, kind: "apple" },
  { entry: "!host:*.1password.com", builtIn: true, kind: "pinned" },
];

const dia = {
  clientName: "Dia",
  clientBundleId: "company.thebrowser.dia",
  clientPath: "/A/Dia.app",
};
const tunnel: EncryptedCardInput["flow"] = {
  url: "www.google.com:443",
  ...dia,
  tunnelReason: "not_listed",
  tunnelExcludedBy: null,
  tunnelExcludedBuiltIn: false,
  tlsRejected: null,
  elapsedMs: 188,
  error: null,
};

function card(over: Partial<EncryptedCardInput> = {}) {
  return encryptedCard({
    flow: tunnel,
    list: BUILT_INS,
    trusted: true,
    canTrust: true,
    passthrough: [],
    ...over,
  });
}

const summary = (c: ReturnType<typeof card>) =>
  c.actions.map((a) => [a.label, a.hint, a.edit ?? null]);

describe("connectionOf", () => {
  test("reads a tunnel's authority and a refused handshake's URL alike", () => {
    expect(
      connectionOf({ url: "www.google.com:443", clientName: null, clientBundleId: null }),
    ).toEqual({
      host: "www.google.com",
      port: 443,
      label: "www.google.com",
      address: "www.google.com:443",
      app: null,
    });
    const c = connectionOf({ url: "https://home.ts.net:8317", ...dia });
    expect(c.label).toBe("home.ts.net:8317");
    expect(c.app).toEqual({ name: "Dia", bundleId: "company.thebrowser.dia" });
    expect(
      connectionOf({ url: "[::1]:8443", clientName: null, clientBundleId: null }),
    ).toMatchObject({ host: "::1", port: 8443, address: "[::1]:8443", label: "[::1]:8443" });
  });
});

describe("the card of an encrypted connection", () => {
  test("nothing decrypted yet: the host, the app and everything, each with what it writes", () => {
    const c = card();
    expect(lineText(c.why)).toBe(
      "**Encrypted Content:** Enable decryption to see requests to `www.google.com`",
    );
    expect(summary(c)).toEqual([
      [
        "Decrypt www.google.com",
        "host:www.google.com",
        { add: ["host:www.google.com"], remove: [] },
      ],
      ["Decrypt Dia", "app:Dia", { add: ["app:Dia"], remove: [] }],
      ["Decrypt Everything", "*", { add: ["*"], remove: [] }],
    ]);
    // Nothing under the buttons while the certificate is trusted
    expect(c.foot).toEqual([]);
    // The info button keeps its general line
    expect(c.tooltip).toBeNull();
  });

  test("asks for the password once while the certificate isn't trusted, where it can be", () => {
    expect(card({ trusted: false }).foot).toEqual(["macOS will ask for a password once."]);
    expect(card({ trusted: false, canTrust: false }).foot).toEqual([]);
  });

  test("something else listed: not on the list, with the same choices", () => {
    const c = card({ list: [...user("host:api.stripe.com"), ...BUILT_INS] });
    expect(lineText(c.why)).toBe(
      "**Encrypted Content:** Enable decryption to see requests to `www.google.com`",
    );
    expect(c.actions.map((a) => a.label)).toEqual([
      "Decrypt www.google.com",
      "Decrypt Dia",
      "Decrypt Everything",
    ]);
  });

  test("no app button for a connection no app is named for", () => {
    const c = card({
      flow: { ...tunnel, clientName: null, clientBundleId: null, clientPath: null },
    });
    expect(c.actions.map((a) => a.label)).toEqual(["Decrypt www.google.com", "Decrypt Everything"]);
  });

  test("names the host nothing on the list covers, its port only when not 443", () => {
    const list = [...user("host:api.stripe.com"), ...BUILT_INS];
    expect(lineText(card({ list, flow: { ...tunnel, url: "t.yaak.app:443" } }).why)).toBe(
      "**Encrypted Content:** Enable decryption to see requests to `t.yaak.app`",
    );
    expect(lineText(card({ list, flow: { ...tunnel, url: "home.ts.net:8317" } }).why)).toBe(
      "**Encrypted Content:** Enable decryption to see requests to `home.ts.net:8317`",
    );
  });

  test("a port off 443 is part of the host it writes", () => {
    const c = card({ flow: { ...tunnel, url: "home.ts.net:8317" } });
    expect(c.actions[0]?.hint).toBe("host:home.ts.net:8317");
    expect(c.actions[0]?.label).toBe("Decrypt home.ts.net:8317");
  });

  test("Decrypt Everything is offered only where * would decrypt it", () => {
    const flow = { ...tunnel, url: "my.1password.com:443", clientName: "1Password" };
    expect(card({ flow }).actions.map((a) => a.label)).not.toContain("Decrypt Everything");
  });

  test("excluded by default: the host alone, dashed, and who may refuse it", () => {
    const pinned = card({
      flow: {
        ...tunnel,
        url: "my.1password.com:443",
        clientName: "1Password",
        clientBundleId: "com.1password",
        tunnelReason: "excluded",
        tunnelExcludedBy: "!host:*.1password.com",
        tunnelExcludedBuiltIn: true,
      },
    });
    expect(lineText(pinned.why)).toBe("Apps that pin certificates are excluded by default.");
    expect(summary(pinned)).toEqual([
      [
        "Decrypt my.1password.com",
        "host:my.1password.com",
        { add: ["host:my.1password.com"], remove: [] },
      ],
    ]);
    expect(pinned.actions[0]?.dashed).toBe(true);
    expect(pinned.foot).toEqual(["1Password may reject the connection."]);

    const apple = card({
      flow: {
        ...tunnel,
        url: "gateway.icloud.apple.com:443",
        clientName: null,
        clientBundleId: null,
        tunnelReason: "excluded",
        tunnelExcludedBy: "!host:*.apple.com",
        tunnelExcludedBuiltIn: true,
      },
    });
    expect(lineText(apple.why)).toBe("Apple services are excluded by default.");
    expect(apple.foot).toEqual(["macOS may reject the connection."]);
  });

  test("excluded by the person: names it, and Stop Excluding when that alone decrypts it", () => {
    const list = [...user("*", "!host:*.google.com"), ...BUILT_INS];
    const c = card({
      list,
      flow: { ...tunnel, tunnelReason: "excluded", tunnelExcludedBy: "!host:*.google.com" },
    });
    expect(lineText(c.why)).toBe("This connection is excluded by `!host:*.google.com`.");
    // Nothing added wins over the person's own exclusion, so taking it off is the way in
    expect(summary(c)).toEqual([
      [
        "Stop Excluding *.google.com",
        "!host:*.google.com",
        { add: [], remove: ["!host:*.google.com"] },
      ],
    ]);
    // Their exact exclusion of the host is one Decrypt takes off itself
    const exact = card({ list: [...user("*", "!host:www.google.com"), ...BUILT_INS] });
    expect(summary(exact)[0]).toEqual([
      "Decrypt www.google.com",
      "host:www.google.com",
      { add: [], remove: ["!host:www.google.com"] },
    ]);

    // Every way in blocked but taking the exclusions off
    const both = [...user("*", "!host:*.google.com", "!app:Dia"), ...BUILT_INS];
    const blocked = card({ list: both });
    expect(summary(blocked)).toEqual([
      [
        "Stop Excluding 2 Entries",
        "!host:*.google.com, !app:Dia",
        { add: [], remove: ["!host:*.google.com", "!app:Dia"] },
      ],
    ]);
    expect(blocked.actions[0]?.removes).toBe(true);
  });

  test("once the list decrypts it: opened before, the opposite, and Reconnect while open", () => {
    const list = [...user("host:www.google.com"), ...BUILT_INS];
    const closed = card({ list });
    expect(lineText(closed.why)).toBe(
      "This connection was opened before `www.google.com` was decrypted.",
    );
    expect(summary(closed)).toEqual([
      [
        "Stop Decrypting www.google.com",
        "host:www.google.com",
        { add: [], remove: ["host:www.google.com"] },
      ],
    ]);
    expect(closed.foot).toEqual([]);

    const open = card({ list, flow: { ...tunnel, elapsedMs: null } });
    expect(open.actions.map((a) => a.kind)).toEqual(["reconnect", "stop"]);

    const everything = card({ list: [...user("*"), ...BUILT_INS] });
    expect(lineText(everything.why)).toBe(
      "This connection was opened before everything was decrypted.",
    );
    expect(everything.actions[0]?.label).toBe("Stop Decrypting Everything");
  });
});

describe("the card of a refused handshake", () => {
  const refused: EncryptedCardInput["flow"] = {
    ...tunnel,
    url: "https://sync.acme.dev",
    clientName: "Acme",
    clientBundleId: "dev.acme",
    clientPath: "/A/Acme.app",
    tunnelReason: null,
    tlsRejected: "bad_certificate",
    elapsedMs: 6,
  };
  const listed = [...user("*"), ...BUILT_INS];

  test("an app: likely pinned, Stop Decrypting first, Retry while passed through", () => {
    const c = card({ flow: refused, list: listed, passthrough: ["sync.acme.dev:443"] });
    expect(c.rejected).toBe(true);
    expect([lineText(c.why), c.tooltip]).toEqual([
      "Acme rejected the certificate.",
      "Acme likely pins its certificate, so it cannot be decrypted.",
    ]);
    expect(summary(c)).toEqual([
      ["Stop Decrypting Acme", "!app:Acme", { add: ["!app:Acme"], remove: [] }],
      ["Retry", "next connection", null],
    ]);
    expect(c.actions[0]?.primary).toBe(true);
    expect(c.foot).toEqual(["This host stays encrypted until Yaak Proxy is relaunched."]);
  });

  test("once no longer passed through, Retry goes and the foot says so", () => {
    const c = card({ flow: refused, list: listed, passthrough: [] });
    expect(c.actions.map((a) => a.kind)).toEqual(["stop"]);
    expect(c.foot).toEqual(["The next connection will be decrypted."]);
  });

  test("no longer passed through but excluded since: no claim that it will be decrypted", () => {
    const excluded = [...user("*", "!app:Acme"), ...BUILT_INS];
    const c = card({ flow: refused, list: excluded, passthrough: [] });
    expect(c.actions).toEqual([]);
    expect(c.foot).toEqual([]);
  });

  test("an untrusted certificate keeps its line once no longer passed through", () => {
    const c = card({ flow: refused, list: listed, trusted: false, passthrough: [] });
    expect(c.foot).toEqual(["This host stays encrypted until the certificate is trusted."]);
  });

  test("a program: its own trust store, Copy Environment first", () => {
    const python = {
      ...refused,
      url: "https://pypi.org",
      clientName: "python3",
      clientBundleId: null,
      clientPath: "/opt/homebrew/bin/python3",
    };
    const c = card({ flow: python, list: listed, passthrough: ["pypi.org:443"] });
    expect([lineText(c.why), c.tooltip]).toEqual([
      "python3 rejected the certificate.",
      "python3 uses its own trust store, so it does not trust the certificate.",
    ]);
    expect(c.actions.map((a) => [a.kind, a.label])).toEqual([
      ["copy_environment", "Copy Environment"],
      ["stop", "Stop Decrypting python3"],
      ["try_again", "Retry"],
    ]);
    expect(c.foot).toEqual(["Paste it into a terminal, then rerun python3."]);
  });

  test("an unknown client: the host", () => {
    const c = card({
      flow: { ...refused, clientName: null, clientBundleId: null, clientPath: null },
      list: listed,
    });
    expect(lineText(c.why)).toBe("An app rejected the certificate.");
    expect(summary(c)[0]).toEqual([
      "Stop Decrypting sync.acme.dev",
      "!host:sync.acme.dev",
      { add: ["!host:sync.acme.dev"], remove: [] },
    ]);
  });

  test("an untrusted certificate explains it: Trust Certificate first", () => {
    const c = card({
      flow: refused,
      list: listed,
      trusted: false,
      passthrough: ["sync.acme.dev:443"],
    });
    expect(lineText(c.why)).toBe("The certificate is not trusted.");
    expect(c.actions.map((a) => a.kind)).toEqual(["trust", "stop"]);
    expect(c.foot).toEqual(["This host stays encrypted until the certificate is trusted."]);
  });

  test("a tunnel after a refusal names the client that refused", () => {
    const after = {
      ...tunnel,
      url: "sync.acme.dev:443",
      tunnelReason: "rejected" as const,
    };
    const c = card({
      flow: after,
      list: listed,
      rejectedBy: { clientName: "Acme", clientBundleId: "dev.acme", clientPath: null },
    });
    expect(lineText(c.why)).toBe("Acme rejected the certificate for this host.");
    // Stop Decrypting acts on this connection, so on Dia's own
    expect(c.actions[0]?.hint).toBe("!app:Dia");
  });
});

describe("Stop Decrypting a refused connection", () => {
  const c = connectionOf({ url: "sync.acme.dev:443", clientName: "Acme", clientBundleId: null });

  test("takes off the entry naming exactly this host when that alone stops it", () => {
    const action = stopDecryptingConnection(user("host:sync.acme.dev"), c);
    expect(action?.edit).toEqual({ add: [], remove: ["host:sync.acme.dev"] });
    expect(action?.label).toBe("Stop Decrypting sync.acme.dev");
  });

  test("else excludes the app, or the host without one, which always wins", () => {
    expect(stopDecryptingConnection(user("*"), c)?.edit).toEqual({
      add: ["!app:Acme"],
      remove: [],
    });
    const anonymous = { ...c, app: null };
    expect(stopDecryptingConnection(user("*", "host:sync.acme.dev"), anonymous)?.edit).toEqual({
      add: ["!host:sync.acme.dev"],
      remove: [],
    });
  });

  test("nothing when the list does not decrypt it", () => {
    expect(stopDecryptingConnection(BUILT_INS, c)).toBeNull();
  });
});
