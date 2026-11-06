import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { DecryptListEntry } from "@yaakapp-internal/proxy-lib";
import { filterCompletionSource } from "@yaakapp-internal/ui/editor";
import { describe, expect, test } from "vite-plus/test";
import {
  blockerOf,
  blockingExclusion,
  decryptFilterOptions,
  decryptMenuAction,
  decrypts,
  decryptsEverything,
  entryLabel,
  isDecrypted,
  normalizeEntry,
  setDecrypted,
  subjectQuery,
  toggleDecrypt,
  withEntry,
  withEverything,
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

  test("offers Decrypt unless every selected row is decrypted", () => {
    expect(decryptMenuAction(user("host:a.com"), [a])).toEqual({
      label: "Stop Decrypting",
      on: false,
    });
    expect(decryptMenuAction(user("host:a.com"), [a, b])).toEqual({ label: "Decrypt", on: true });
    expect(decryptMenuAction([], [])).toBeNull();
  });

  test("applies to every selected row, leaving those already so", () => {
    const next = setDecrypted(user("host:a.com"), [a, b], true).map((e) => e.entry);
    expect(next).toEqual(["host:a.com", "host:b.com"]);
    expect(setDecrypted(user("host:a.com", "host:b.com"), [a, b], false)).toEqual([]);
  });
});

describe("the first-run step", () => {
  test("Everything adds * once, after the user's entries", () => {
    expect(decryptsEverything(BUILT_INS)).toBe(false);
    const on = withEverything([...user("host:a.com"), ...BUILT_INS], true);
    expect(on).toEqual(["host:a.com", "*", "!host:*.apple.com", "!host:*.icloud.com"]);
    expect(withEntry(user("*"), "*")).toEqual(["*"]);
  });

  test("Pick as they appear takes * out", () => {
    expect(withEverything([...user("*"), ...BUILT_INS], false)).toEqual([
      "!host:*.apple.com",
      "!host:*.icloud.com",
    ]);
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
