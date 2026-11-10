import type { DecryptListEntry, Flow } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import { chooseOptions, connectionCount, type StripInput, stripState } from "./httpsStrip";

const BUILT_INS: DecryptListEntry[] = [
  { entry: "!host:*.apple.com", builtIn: true, kind: "apple" },
  { entry: "!host:*.1password.com", builtIn: true, kind: "pinned" },
];
const base: StripInput = {
  list: BUILT_INS,
  encrypted: 22,
  dismissed: false,
  trusted: false,
  canTrust: true,
};

describe("the strip", () => {
  test("shows while nothing is decrypted and something is encrypted", () => {
    expect(stripState(base)).toBe("offer");
    expect(stripState({ ...base, trusted: true })).toBe("offer");
  });

  test("goes once something is listed, with nothing encrypted, or dismissed", () => {
    const listed = [{ entry: "app:Dia", builtIn: false }, ...BUILT_INS];
    expect(stripState({ ...base, list: listed, trusted: true })).toBe("hidden");
    expect(stripState({ ...base, encrypted: 0 })).toBe("hidden");
    expect(stripState({ ...base, dismissed: true })).toBe("hidden");
    // Exclusions alone decrypt nothing
    const excluded = [{ entry: "!app:Dia", builtIn: false }, ...BUILT_INS];
    expect(stripState({ ...base, list: excluded })).toBe("offer");
  });

  test("comes back broken, however dismissed, while something listed can't be decrypted", () => {
    const listed = [{ entry: "*", builtIn: false }, ...BUILT_INS];
    expect(stripState({ ...base, list: listed, dismissed: true })).toBe("broken");
    // Not where the app can't trust it itself, nor before the status is read
    expect(stripState({ ...base, list: listed, canTrust: false })).toBe("hidden");
    expect(stripState({ ...base, list: listed, trusted: null })).toBe("hidden");
  });

  test("counts connections", () => {
    expect(connectionCount(1)).toBe("1 connection");
    expect(connectionCount(1200)).toBe("1,200 connections");
  });
});

describe("Choose…", () => {
  const flow = (url: string, app: Partial<Flow>, tunnelled = true) => ({
    url,
    tunnelled,
    clientName: null,
    clientBundleId: null,
    clientPath: null,
    ...app,
  });
  const dia = { clientName: "Dia", clientBundleId: "company.dia", clientPath: "/A/Dia.app" };
  const slack = { clientName: "Slack", clientBundleId: "com.slack", clientPath: "/A/Slack.app" };
  const flows = [
    flow("www.google.com:443", dia),
    flow("fonts.gstatic.com:443", dia),
    flow("clients2.google.com:443", dia),
    flow("edgeapi.slack.com:443", slack),
    // Decrypted already, so not one of the encrypted
    flow("https://slack.com/api", slack, false),
    // A daemon, and what a built-in keeps out, are deliberate choices elsewhere
    flow("gateway.icloud.com:443", { clientName: "cloudd", clientPath: "/usr/libexec/cloudd" }),
    flow("my.1password.com:443", { clientName: "1Password", clientBundleId: "com.1password" }),
  ];

  test("lists apps and sites seen, most connections first, checked while decrypted", () => {
    const list = [{ entry: "host:*.slack.com", builtIn: false }, ...BUILT_INS];
    const { apps, sites } = chooseOptions(flows, list);
    expect(apps.map((a) => [a.name, a.count, a.checked])).toEqual([
      ["Dia", 3, false],
      ["Slack", 1, false],
    ]);
    expect(sites.map((s) => [s.site, s.count, s.checked])).toEqual([
      ["google.com", 2, false],
      ["gstatic.com", 1, false],
      ["slack.com", 1, true],
    ]);
  });
});
