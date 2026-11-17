import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { DecryptListEntry } from "@yaakapp-internal/proxy-lib";
import { filterCompletionSource } from "@yaakapp-internal/ui/editor";
import { describe, expect, test } from "vite-plus/test";
import {
  blockerOf,
  blockingExclusion,
  decryptFilterOptions,
  detailActions,
  decryptMenuAction,
  decrypts,
  decryptsEverything,
  editDecrypts,
  entryLabel,
  entrySubject,
  everythingEdit,
  inverseEdit,
  listSummary,
  isDecrypted,
  listEdit,
  normalizeEntry,
  setDecrypted,
  subjectQuery,
  toggleDecrypt,
} from "./decrypt";

const user = (...entries: string[]): DecryptListEntry[] =>
  entries.map((entry) => ({ entry, builtIn: false }));
const builtIn = (...entries: string[]): DecryptListEntry[] =>
  entries.map((entry) => ({ entry, builtIn: true }));
const BUILT_INS = builtIn("!host:*.apple.com", "!host:*.icloud.com");

describe("normalizeEntry", () => {
  test("a bare hostname is a host entry", () => {
    expect(normalizeEntry("api.example.com")).toBe("host:api.example.com");
    expect(normalizeEntry("  API.Example.com. ")).toBe("host:api.example.com");
    expect(normalizeEntry("https://api.example.com:8443/v1")).toBe("host:api.example.com:8443");
  });

  test("prefixes and exclusions", () => {
    expect(normalizeEntry("HOST:*.Example.com")).toBe("host:*.example.com");
    expect(normalizeEntry("!x.com")).toBe("!host:x.com");
    expect(normalizeEntry("! host:x.com")).toBe("!host:x.com");
    expect(normalizeEntry('app:"Google Chrome"')).toBe("app:Google Chrome");
    expect(normalizeEntry("App: com.google.Chrome")).toBe("app:com.google.Chrome");
    expect(normalizeEntry("host:[::1]:8443")).toBe("host:[::1]:8443");
    expect(normalizeEntry(" * ")).toBe("*");
  });

  test("what is not an entry", () => {
    for (const bad of ["", "!", "app:", "host:a b", "host:a.com:http", "host:a.com:99999"]) {
      expect(normalizeEntry(bad)).toBeNull();
    }
  });

  test("labels", () => {
    expect(entryLabel("*")).toBe("Everything");
    expect(entryLabel("host:a.com")).toBe("host:a.com");
  });
});

describe("decrypts", () => {
  test("an empty list decrypts nothing, with or without the built-ins", () => {
    expect(decrypts([], { host: "a.com" })).toBe(false);
    expect(decrypts(BUILT_INS, { host: "a.com" })).toBe(false);
  });

  test("hosts, sites and ports", () => {
    const list = user("host:*.example.com", "host:other.com:8443");
    expect(decrypts(list, { host: "api.example.com" })).toBe(true);
    expect(decrypts(list, { host: "example.com" })).toBe(true);
    expect(decrypts(list, { host: "notexample.com" })).toBe(false);
    expect(decrypts(list, { host: "other.com", port: 8443 })).toBe(true);
    expect(decrypts(list, { host: "other.com" })).toBe(false);
  });

  test("apps by name or bundle id", () => {
    const chrome = { name: "Google Chrome", bundleId: "com.google.Chrome" };
    expect(decrypts(user("app:google chrome"), { host: "a.com", app: chrome })).toBe(true);
    expect(decrypts(user("app:com.google.*"), { host: "a.com", app: chrome })).toBe(true);
    expect(decrypts(user("app:Safari"), { host: "a.com", app: chrome })).toBe(false);
  });

  test("everything keeps the built-in exclusions, which a specific entry beats", () => {
    const list = [...user("*"), ...BUILT_INS];
    expect(decrypts(list, { host: "api.example.com" })).toBe(true);
    expect(decrypts(list, { host: "gateway.icloud.com" })).toBe(false);
    const specific = [...user("*", "host:developer.apple.com"), ...BUILT_INS];
    expect(decrypts(specific, { host: "developer.apple.com" })).toBe(true);
    expect(decrypts(specific, { host: "www.apple.com" })).toBe(false);
  });

  test("the user's exclusions win wherever they sit", () => {
    for (const list of [user("!host:a.example.com", "*"), user("*", "!host:a.example.com")]) {
      expect(decrypts(list, { host: "a.example.com" })).toBe(false);
      expect(decrypts(list, { host: "b.example.com" })).toBe(true);
    }
  });
});

describe("the sidebar's Decrypt and Stop Decrypting", () => {
  test("Decrypt adds the host's entry before the built-ins", () => {
    const list = BUILT_INS;
    const subject = { kind: "host", host: "api.example.com" } as const;
    expect(isDecrypted(list, subject)).toBe(false);
    expect(toggleDecrypt(list, subject)).toEqual([
      "host:api.example.com",
      "!host:*.apple.com",
      "!host:*.icloud.com",
    ]);
  });

  test("Stop Decrypting removes the entry that decrypts it", () => {
    const list = [...user("host:api.example.com", "host:b.com"), ...BUILT_INS];
    const subject = { kind: "host", host: "api.example.com" } as const;
    expect(isDecrypted(list, subject)).toBe(true);
    expect(toggleDecrypt(list, subject)).toEqual([
      "host:b.com",
      "!host:*.apple.com",
      "!host:*.icloud.com",
    ]);
  });

  test("Stop Decrypting under everything excludes the host", () => {
    const list = user("*");
    const subject = { kind: "site", site: "example.com" } as const;
    expect(isDecrypted(list, subject)).toBe(true);
    expect(toggleDecrypt(list, subject)).toEqual(["*", "!host:*.example.com"]);
  });

  test("Decrypt adds nothing while a broader exclusion of the user's would still win", () => {
    const list = user("*", "!host:*.example.com");
    const subject = { kind: "host", host: "api.example.com" } as const;
    expect(blockingExclusion(list, subjectQuery(subject))).toBe("!host:*.example.com");
    expect(toggleDecrypt(list, subject)).toEqual(["*", "!host:*.example.com"]);
    // The built-ins are not the user's to block with: a specific entry beats them.
    expect(blockingExclusion(BUILT_INS, { host: "www.apple.com" })).toBeNull();
  });

  test("Decrypt undoes the sidebar's own Stop Decrypting", () => {
    const subject = { kind: "site", site: "example.com" } as const;
    const stopped = toggleDecrypt(user("*"), subject);
    expect(stopped).toEqual(["*", "!host:*.example.com"]);
    const list = user(...stopped);
    expect(blockerOf(list, [subject])).toBeNull();
    expect(toggleDecrypt(list, subject)).toEqual(["*"]);
    const host = { kind: "host", host: "api.example.com" } as const;
    expect(blockerOf(list, [host])).toBe("!host:*.example.com");
  });

  test("an exact site entry beats the built-in exclusion of the same site", () => {
    expect(decrypts([...user("host:apple.com"), ...BUILT_INS], { host: "apple.com" })).toBe(true);
  });

  test("Decrypt drops the user's own exclusion first", () => {
    const list = user("*", "!host:*.example.com");
    const subject = { kind: "site", site: "example.com" } as const;
    expect(toggleDecrypt(list, subject)).toEqual(["*"]);
  });

  test("apps by name, and a host with a port", () => {
    const slack = { kind: "app", name: "Slack", bundleId: "com.tinyspeck.slackmacgap" } as const;
    expect(toggleDecrypt([], slack)).toEqual(["app:Slack"]);
    expect(isDecrypted(user("app:com.tinyspeck.slackmacgap"), slack)).toBe(true);
    expect(isDecrypted(user("*"), slack)).toBe(true);
    const port = { kind: "host", host: "localhost:8443" } as const;
    expect(toggleDecrypt([], port)).toEqual(["host:localhost:8443"]);
    expect(isDecrypted(user("host:localhost:8443"), port)).toBe(true);
  });
});

describe("the sidebar menu", () => {
  const a = { kind: "host", host: "a.com" } as const;
  const b = { kind: "host", host: "b.com" } as const;

  test("offers Decrypt unless every selected row is decrypted, naming what it changes", () => {
    expect(decryptMenuAction(user("host:a.com"), [a])).toEqual({
      label: "Stop Decrypting a.com",
      on: false,
      subject: "a.com",
    });
    expect(decryptMenuAction(user("host:a.com"), [a, b])).toEqual({
      label: "Decrypt 2 Hosts",
      on: true,
      subject: "2 hosts",
    });
    expect(decryptMenuAction([], [])).toBeNull();
  });

  test("names sites, apps and mixed rows", () => {
    const site = { kind: "site", site: "google.com" } as const;
    const dia = { kind: "app", name: "Dia", bundleId: null } as const;
    expect(decryptMenuAction([], [site])?.label).toBe("Decrypt *.google.com");
    expect(decryptMenuAction([], [dia])?.label).toBe("Decrypt Dia");
    expect(decryptMenuAction([], [site, { kind: "site", site: "x.com" }])?.label).toBe(
      "Decrypt 2 Domains",
    );
    expect(decryptMenuAction([], [dia, a, site])?.label).toBe("Decrypt 3 Selected");
  });

  test("applies to every selected row, leaving those already so", () => {
    const next = setDecrypted(user("host:a.com"), [a, b], true).map((e) => e.entry);
    expect(next).toEqual(["host:a.com", "host:b.com"]);
    expect(setDecrypted(user("host:a.com", "host:b.com"), [a, b], false)).toEqual([]);
  });
});

describe("the Not decrypted detail's buttons", () => {
  const slack = { name: "Slack", bundleId: "com.tinyspeck.slackmacgap" };

  test("each button is offered only when its own change would decrypt the connection", () => {
    // `!app:Slack` still excludes Slack's connections whatever host is added.
    const list = user("*", "!app:Slack");
    expect(detailActions(list, "edgeapi.slack.com", slack)).toEqual({
      listed: false,
      host: false,
      app: true,
      blocked: null,
    });
    // And `!host:` the other way round.
    expect(detailActions(user("*", "!host:edgeapi.slack.com"), "edgeapi.slack.com", slack)).toEqual(
      { listed: false, host: true, app: false, blocked: null },
    );
  });

  test("names the exclusion when neither would", () => {
    const list = user("*", "!host:*.slack.com", "!app:Slack");
    expect(detailActions(list, "edgeapi.slack.com", slack)).toEqual({
      listed: false,
      host: false,
      app: false,
      blocked: "!host:*.slack.com",
    });
  });

  test("both on an empty list, and none once it is listed", () => {
    expect(detailActions(BUILT_INS, "a.com", slack)).toEqual({
      listed: false,
      host: true,
      app: true,
      blocked: null,
    });
    expect(detailActions(user("host:a.com"), "a.com", null).listed).toBe(true);
  });
});

describe("Decrypt Everything", () => {
  test("adds *, and the switch off takes it out", () => {
    expect(decryptsEverything(BUILT_INS)).toBe(false);
    expect(decryptsEverything([...user("*"), ...BUILT_INS])).toBe(true);
    expect(everythingEdit(true)).toEqual({ add: ["*"], remove: [] });
    expect(everythingEdit(false)).toEqual({ add: [], remove: ["*"] });
  });
});

describe("edits sent as additions and removals", () => {
  test("a toggle becomes what it adds and removes, not the whole list", () => {
    const list = [...user("*", "!host:*.example.com"), ...BUILT_INS];
    const site = { kind: "site", site: "example.com" } as const;
    expect(listEdit(list, setDecrypted(list, [site], true))).toEqual({
      add: [],
      remove: ["!host:*.example.com"],
    });
    const host = { kind: "host", host: "a.com" } as const;
    expect(listEdit(BUILT_INS, setDecrypted(BUILT_INS, [host], true))).toEqual({
      add: ["host:a.com"],
      remove: [],
    });
  });

  test("two edits from the same stale list both survive, applied in turn", () => {
    // What the lib does with each edit: remove, then add after the user's own entries.
    const apply = (entries: string[], e: { add: string[]; remove: string[] }) => [
      ...entries.filter((x) => !e.remove.includes(x)),
      ...e.add,
    ];
    const stale = BUILT_INS;
    const first = listEdit(stale, setDecrypted(stale, [{ kind: "host", host: "a.com" }], true));
    const second = listEdit(stale, setDecrypted(stale, [{ kind: "host", host: "b.com" }], true));
    const saved = apply(apply([], first), second);
    expect(saved).toEqual(["host:a.com", "host:b.com"]);
  });
});

describe("the list's autocomplete", () => {
  const source = filterCompletionSource(
    decryptFilterOptions({
      hosts: ["api.example.com", "www.example.org"],
      apps: [
        { name: "Google Chrome", bundleId: "com.google.Chrome" },
        { name: "curl", bundleId: null },
      ],
    }),
  );

  function complete(doc: string) {
    const state = EditorState.create({ doc });
    const result = source(new CompletionContext(state, doc.length, true));
    if (result == null || result instanceof Promise) return null;
    return { from: result.from, labels: result.options.map((o) => o.label) };
  }

  test("an empty input offers host:, app: and !", () => {
    expect(complete("")).toEqual({ from: 0, labels: ["host", "app", "!"] });
    expect(complete("ho")).toEqual({ from: 0, labels: ["host", "app", "!"] });
  });

  test("after ! it offers the fields negated", () => {
    expect(complete("!")).toEqual({ from: 0, labels: ["!host", "!app"] });
    expect(complete("!ap")).toEqual({ from: 0, labels: ["!host", "!app"] });
  });

  test("after host: the hosts seen, replacing only the value", () => {
    expect(complete("host:")).toEqual({ from: 5, labels: ["api.example.com", "www.example.org"] });
    expect(complete("!host:api")?.from).toBe(6);
  });

  test("after app: the apps seen, by name and bundle id", () => {
    expect(complete("app:")).toEqual({
      from: 4,
      labels: ['"Google Chrome"', "com.google.Chrome", "curl"],
    });
  });
});

describe("what a change says", () => {
  test("the pill counts the person's own positive entries", () => {
    expect(listSummary([...user("app:Dia", "app:Slack", "host:*.google.com"), ...BUILT_INS])).toBe(
      "2 apps, 1 host",
    );
    expect(listSummary([...user("*", "!host:a.com"), ...BUILT_INS])).toBeNull();
  });

  test("names an entry's subject", () => {
    expect(entrySubject("host:www.google.com")).toBe("www.google.com");
    expect(entrySubject("host:*.google.com")).toBe("*.google.com");
    expect(entrySubject("app:Dia")).toBe("Dia");
    expect(entrySubject("*")).toBe("Everything");
  });

  test("an edit can decrypt when it adds a positive entry or drops an exclusion", () => {
    expect(editDecrypts({ add: ["host:a.com"], remove: [] })).toBe(true);
    expect(editDecrypts({ add: [], remove: ["!host:a.com"] })).toBe(true);
    expect(editDecrypts({ add: ["!app:Dia"], remove: ["host:a.com"] })).toBe(false);
    expect(inverseEdit({ add: ["a"], remove: ["b"] })).toEqual({ add: ["b"], remove: ["a"] });
  });
});
