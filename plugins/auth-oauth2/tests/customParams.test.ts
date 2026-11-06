import { describe, expect, test } from "vite-plus/test";
import {
  applyQueryParams,
  mergeFormParams,
  mergeHeaders,
  parsePairs,
  readCustomParams,
} from "../src/customParams";

function pairs(...rows: { name: string; value: string; enabled?: boolean }[]) {
  return JSON.stringify(rows.map((r) => ({ enabled: true, ...r })));
}

describe("parsePairs", () => {
  test("reads enabled rows", () => {
    expect(parsePairs(pairs({ name: "Origin", value: "https://app.example.com" }))).toEqual([
      { name: "Origin", value: "https://app.example.com" },
    ]);
  });

  test("skips disabled rows", () => {
    const value = pairs(
      { name: "Origin", value: "https://app.example.com" },
      { name: "X-Debug", value: "1", enabled: false },
    );

    expect(parsePairs(value).map((p) => p.name)).toEqual(["Origin"]);
  });

  test("skips rows without a name", () => {
    expect(parsePairs(pairs({ name: "  ", value: "ignored" }))).toEqual([]);
  });

  test("trims names and keeps empty values", () => {
    expect(parsePairs(pairs({ name: " realm ", value: "" }))).toEqual([
      { name: "realm", value: "" },
    ]);
  });

  test("returns nothing for missing or malformed input", () => {
    expect(parsePairs(undefined)).toEqual([]);
    expect(parsePairs("")).toEqual([]);
    expect(parsePairs("not json")).toEqual([]);
    expect(parsePairs('{"name":"Origin"}')).toEqual([]);
  });
});

describe("merge precedence", () => {
  const generated = [
    { name: "User-Agent", value: "yaak" },
    { name: "Content-Type", value: "application/x-www-form-urlencoded" },
  ];

  test("keeps generated entries that are not overridden", () => {
    const merged = mergeHeaders(generated, [{ name: "Origin", value: "https://app.example.com" }]);

    expect(merged).toEqual([...generated, { name: "Origin", value: "https://app.example.com" }]);
  });

  test("replaces generated headers by name, ignoring case", () => {
    const merged = mergeHeaders(generated, [{ name: "content-type", value: "application/json" }]);

    expect(merged).toEqual([
      { name: "User-Agent", value: "yaak" },
      { name: "content-type", value: "application/json" },
    ]);
  });

  test("keeps repeated custom entries of the same name", () => {
    const merged = mergeHeaders(generated, [
      { name: "X-Trace", value: "a" },
      { name: "X-Trace", value: "b" },
    ]);

    expect(merged.filter((h) => h.name === "X-Trace")).toHaveLength(2);
  });

  test("matches form params case-sensitively", () => {
    const merged = mergeFormParams(
      [{ name: "scope", value: "openid" }],
      [{ name: "Scope", value: "other" }],
    );

    expect(merged).toEqual([
      { name: "scope", value: "openid" },
      { name: "Scope", value: "other" },
    ]);
  });
});

describe("applyQueryParams", () => {
  test("appends custom params and overrides generated ones", () => {
    const url = new URL("https://auth.example.com/authorize?client_id=abc&scope=openid");

    applyQueryParams(url, [
      { name: "scope", value: "openid email" },
      { name: "realm", value: "employees" },
    ]);

    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.getAll("scope")).toEqual(["openid email"]);
    expect(url.searchParams.get("realm")).toBe("employees");
  });

  test("keeps repeated custom params", () => {
    const url = new URL("https://auth.example.com/authorize");

    applyQueryParams(url, [
      { name: "resource", value: "one" },
      { name: "resource", value: "two" },
    ]);

    expect(url.searchParams.getAll("resource")).toEqual(["one", "two"]);
  });
});

describe("readCustomParams", () => {
  test("sends token entries on the refresh request too", () => {
    const custom = readCustomParams({
      tokenHeaders: pairs({ name: "Origin", value: "https://app.example.com" }),
      tokenBodyParams: pairs({ name: "realm", value: "employees" }),
    });

    expect(custom.refresh.headers).toEqual([{ name: "Origin", value: "https://app.example.com" }]);
    expect(custom.refresh.body).toEqual([{ name: "realm", value: "employees" }]);
  });

  test("lets a refresh entry override the token entry of the same name", () => {
    const custom = readCustomParams({
      tokenHeaders: pairs({ name: "Origin", value: "https://app.example.com" }),
      refreshHeaders: pairs({ name: "origin", value: "https://refresh.example.com" }),
      tokenBodyParams: pairs({ name: "realm", value: "employees" }),
      refreshBodyParams: pairs({ name: "realm", value: "service" }),
    });

    // The token request is unaffected by the refresh-only entries
    expect(custom.token.headers).toEqual([{ name: "Origin", value: "https://app.example.com" }]);
    expect(custom.token.body).toEqual([{ name: "realm", value: "employees" }]);

    expect(custom.refresh.headers).toEqual([
      { name: "origin", value: "https://refresh.example.com" },
    ]);
    expect(custom.refresh.body).toEqual([{ name: "realm", value: "service" }]);
  });

  test("reads authorization params separately", () => {
    const custom = readCustomParams({
      authorizationParams: pairs({ name: "prompt", value: "consent" }),
    });

    expect(custom.authorizationQuery).toEqual([{ name: "prompt", value: "consent" }]);
    expect(custom.token.headers).toEqual([]);
  });

  test("is empty when nothing is configured", () => {
    const custom = readCustomParams({ clientId: "abc" });

    expect(custom).toEqual({
      authorizationQuery: [],
      token: { headers: [], body: [] },
      refresh: { headers: [], body: [] },
    });
  });
});
