import type { Flow } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import { matchesQuery, searchTerms, selectionQuery } from "./search";

function flow(url: string, extra: Partial<Flow> = {}): Flow {
  return {
    url,
    method: "GET",
    status: 200,
    contentType: null,
    clientBundleId: null,
    clientPath: null,
    ...extra,
  } as Flow;
}

// The same flows and terms as `search_matches_url_method_status_and_content_type` in
// `flows.rs`, so the live matcher and the database agree.
const stripe = flow("https://api.stripe.com/v1/charges?customer=cus_9", {
  method: "POST",
  contentType: "application/json; charset=utf-8",
});
const github = flow("https://api.github.com/repos/yaak", {
  status: 404,
  contentType: "application/json; charset=utf-8",
});
const logo = flow("https://images.ctfassets.net/logo.png", { contentType: "image/png" });
const health = flow("http://localhost:3000/health", { method: "HEAD", status: 503 });
const all = [stripe, github, logo, health];

const search = (q: string) => all.filter((f) => matchesQuery(f, { q }));

describe("matchesQuery", () => {
  test("matches the host, the path and the query, any case", () => {
    expect(search("STRIPE")).toEqual([stripe]);
    expect(search("/repos/")).toEqual([github]);
    expect(search("cus_9")).toEqual([stripe]);
  });

  test("matches the whole method", () => {
    expect(search("head")).toEqual([health]);
    expect(search("ead")).toEqual([]);
  });

  test("matches a status, its start, or its class", () => {
    expect(search("404")).toEqual([github]);
    expect(search("50")).toEqual([health]);
    expect(search("2xx")).toEqual([stripe, logo]);
  });

  test("matches the content type", () => {
    expect(search("png")).toEqual([logo]);
    expect(search("json")).toEqual([stripe, github]);
  });

  test("needs every term to match", () => {
    expect(search("json get")).toEqual([github]);
    expect(search("  json   2xx ")).toEqual([stripe]);
    expect(search("json 5xx")).toEqual([]);
    expect(search("")).toEqual(all);
  });

  test("keeps flows under a host or path, on any port of a host", () => {
    const under = (node: string, url: string) => matchesQuery(flow(url), { under: [node] });
    expect(under("api.stripe.com", "https://api.stripe.com/v1/charges")).toBe(true);
    expect(under("api.stripe.com", "http://api.stripe.com")).toBe(true);
    expect(under("api.stripe.com", "https://api.stripe.com:8443/v1")).toBe(true);
    expect(under("api.stripe.com", "https://api.stripe.community/")).toBe(false);
    expect(under("api.stripe.com/v1/charges", "https://api.stripe.com/v1/charges/ch_1?x")).toBe(
      true,
    );
    expect(under("api.stripe.com/v1/charges", "https://api.stripe.com/v1/chargesx")).toBe(false);
    expect(under("api.stripe.com:8443", "https://api.stripe.com/v1")).toBe(false);
  });

  test("keeps flows from an app, by bundle id or path", () => {
    const chrome = flow("https://example.com/", {
      clientBundleId: "com.google.Chrome",
      clientPath: "/Applications/Google Chrome.app",
    });
    const curl = flow("https://example.com/", { clientPath: "/usr/bin/curl" });
    const unknown = flow("https://example.com/");
    const from = (app: string[]) => [chrome, curl, unknown].filter((f) => matchesQuery(f, { app }));
    expect(from(["com.google.Chrome"])).toEqual([chrome]);
    expect(from(["/usr/bin/curl"])).toEqual([curl]);
    expect(from(["/Applications/Google Chrome.app"])).toEqual([]);
  });

  test("combines terms with the sidebar's selection", () => {
    expect(matchesQuery(stripe, { q: "post", under: ["api.stripe.com"] })).toBe(true);
    expect(matchesQuery(stripe, { q: "post", under: ["api.github.com"] })).toBe(false);
  });
});

describe("selectionQuery", () => {
  test("is null for nothing selected or a node holding every flow", () => {
    expect(selectionQuery([])).toBeNull();
    expect(selectionQuery(["root"])).toBeNull();
    expect(selectionQuery(["domain:a.com", "domains"])).toBeNull();
    expect(selectionQuery(["apps"])).toBeNull();
  });

  test("splits hosts and paths from apps", () => {
    expect(selectionQuery(["domain:a.com", "path:b.com/v1", "app:com.apple.Safari"])).toEqual({
      under: ["a.com", "b.com/v1"],
      app: ["com.apple.Safari"],
    });
    expect(selectionQuery(["app:/usr/bin/curl"])).toEqual({ app: ["/usr/bin/curl"] });
  });
});

describe("searchTerms", () => {
  test("trims and collapses the box's text, or is null without any", () => {
    expect(searchTerms("  stripe   post ")).toBe("stripe post");
    expect(searchTerms("   ")).toBeNull();
  });
});
