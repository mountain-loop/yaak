import type { Flow } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import {
  appKeyOf,
  formatFieldFilter,
  isSystemFlow,
  matchesQuery,
  parseSearch,
  sidebarPath,
  siteOf,
  tokenize,
} from "./search";

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

  test("keeps flows under a host or path, as the sidebar places them", () => {
    const under = (node: string, url: string) => matchesQuery(flow(url), { under: [node] });
    expect(under("api.stripe.com", "https://api.stripe.com/v1/charges")).toBe(true);
    expect(under("api.stripe.com", "http://api.stripe.com")).toBe(true);
    // Another port is a host node of its own, as in the sidebar.
    expect(under("api.stripe.com", "https://api.stripe.com:8443/v1")).toBe(false);
    // Empty segments and default ports are left out, as the sidebar leaves them.
    expect(under("example.com/v1/users", "https://example.com/v1//users")).toBe(true);
    expect(under("x.com/a", "http://x.com:80/a")).toBe(true);
    expect(under("api.stripe.com", "https://api.stripe.community/")).toBe(false);
    expect(under("api.stripe.com/v1/charges", "https://api.stripe.com/v1/charges/ch_1?x")).toBe(
      true,
    );
    expect(under("api.stripe.com/v1/charges", "https://api.stripe.com/v1/chargesx")).toBe(false);
    expect(under("api.stripe.com:8443", "https://api.stripe.com/v1")).toBe(false);
    // The sidebar lowercases hosts; paths keep their case.
    expect(under("example.com/A", "http://EXAMPLE.com/A/b")).toBe(true);
    expect(under("example.com/a", "http://example.com/A")).toBe(false);
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

  test("keeps flows from an app by name, or a program by the folder it ran in", () => {
    // The flows `filters_by_app_name_folder_site_and_system` in `flows.rs` checks.
    const slack = flow("https://edgeapi.slack.com/cache", {
      clientName: "Slack",
      clientBundleId: "com.tinyspeck.slackmacgap",
      clientPath: "/Applications/Slack.app",
    });
    const node = flow("https://api.github.com:443/repos", {
      clientName: "node",
      clientPath: "/opt/homebrew/bin/node",
      clientCwd: "/Users/me/src/fieldwork",
    });
    const daemon = flow("https://github.com/login", {
      clientName: "nsurlsessiond",
      clientPath: "/usr/libexec/nsurlsessiond",
      clientCwd: "/",
    });
    const none = flow("http://notgithub.com/");
    const flows = [slack, node, daemon, none];
    const where = (query: Parameters<typeof matchesQuery>[1]) =>
      flows.filter((f) => matchesQuery(f, query));
    expect(where({ app: ["slack"] })).toEqual([slack]);
    expect(where({ app: ["Fieldwork"] })).toEqual([node]);
    expect(where({ app: ["/opt/homebrew/bin/node"] })).toEqual([node]);
    expect(where({ under: ["*.github.com"] })).toEqual([node, daemon]);
    expect(where({ under: ["api.github.com"] })).toEqual([node]);
    expect(where({ system: true })).toEqual([daemon]);
    expect(where({ system: false })).toEqual([slack, node, none]);
    expect(flows.map(appKeyOf)).toEqual(["Slack", "fieldwork", "nsurlsessiond", null]);
  });

  test("combines terms with the sidebar's selection", () => {
    expect(matchesQuery(stripe, { q: "post", under: ["api.stripe.com"] })).toBe(true);
    expect(matchesQuery(stripe, { q: "post", under: ["api.github.com"] })).toBe(false);
  });
});

describe("sidebarPath", () => {
  // The cases `sidebar_path_rules` in `flows.rs` checks, so the two agree.
  test("is the lowercased host without its default port, then the non-empty segments", () => {
    for (const [url, path] of [
      ["https://example.com/v1//users", "example.com/v1/users"],
      ["http://x.com:80/a", "x.com/a"],
      ["https://x.com:443/a?q=1#f", "x.com/a"],
      ["http://x.com:443/a", "x.com:443/a"],
      ["https://API.Stripe.com:8443/", "api.stripe.com:8443"],
      ["https://api.stripe.com", "api.stripe.com"],
      ["https://api.stripe.com?x=/y", "api.stripe.com"],
      ["http://[::1]:80/a/B", "[::1]/a/B"],
      ["/api", "/api"],
    ]) {
      expect(sidebarPath(url ?? ""), url).toBe(path);
    }
  });
});

describe("parseSearch", () => {
  test("is null for text that narrows nothing", () => {
    expect(parseSearch("")).toBeNull();
    expect(parseSearch("   ")).toBeNull();
    expect(parseSearch("OR")).toBeNull();
  });

  test("keeps free words as terms, trimmed and collapsed", () => {
    expect(parseSearch("  stripe   post ")).toEqual({ q: "stripe post" });
  });

  test("reads apps, hosts and the paths below them", () => {
    expect(parseSearch('@app:"Google Chrome" @app:Slack card')).toEqual({
      q: "card",
      app: ["Google Chrome", "Slack"],
    });
    expect(parseSearch("@app:fieldwork @host:api.stripe.com @path:/v1/payment_intents")).toEqual({
      app: ["fieldwork"],
      under: ["api.stripe.com/v1/payment_intents"],
    });
    expect(parseSearch("@host:*.github.com")).toEqual({ under: ["*.github.com"] });
    expect(parseSearch("@host:github.com @path:/mountain-loop/yaak/*")).toEqual({
      under: ["github.com/mountain-loop/yaak"],
    });
    // A path with no host matches anywhere in the URL.
    expect(parseSearch("@path:/v1")).toEqual({ q: "/v1" });
    // Each path stays with the host before it.
    expect(parseSearch("@host:a.com @path:/x @host:b.com @path:/y")).toEqual({
      under: ["a.com/x", "b.com/y"],
    });
  });

  test("keeps each clause OR separates as a group of its own", () => {
    // Two selected sidebar rows under different apps: Slack on a.com, or Chrome on b.com.
    const text = "@app:Slack @host:a.com OR @app:Chrome @host:b.com";
    const query = parseSearch(text);
    expect(query).toEqual({
      any: [
        { app: ["Slack"], under: ["a.com"] },
        { app: ["Chrome"], under: ["b.com"] },
      ],
    });
    const on = (clientName: string, host: string) =>
      flow(`https://${host}/x`, { clientName, clientBundleId: `app.${clientName}` });
    const match = (f: Flow) => query != null && matchesQuery(f, query);
    expect(match(on("Slack", "a.com"))).toBe(true);
    expect(match(on("Chrome", "b.com"))).toBe(true);
    // Not every pairing of the two rows' apps and hosts.
    expect(match(on("Slack", "b.com"))).toBe(false);
    expect(match(on("Chrome", "a.com"))).toBe(false);

    // Words bind to their clause, and hiding System applies to each group that does not ask.
    expect(parseSearch("@host:a.com OR @is:system @app:trustd", true)).toEqual({
      any: [
        { under: ["a.com"], system: false },
        { app: ["trustd"], system: true },
      ],
    });
    // A clause that narrows nothing takes in every flow.
    expect(parseSearch("@app:Slack OR")).toEqual({ app: ["Slack"] });
    expect(parseSearch("@app:Slack OR -@foo:bar")).toBeNull();
  });

  test("keeps or drops System, which hiding it drops unless the text asks", () => {
    expect(parseSearch("@is:system")).toEqual({ system: true });
    expect(parseSearch("-@is:system stripe")).toEqual({ q: "stripe", system: false });
    expect(parseSearch("", true)).toEqual({ system: false });
    expect(parseSearch("@is:system", true)).toEqual({ system: true });
  });

  test("round-trips what the sidebar writes", () => {
    const text = [
      formatFieldFilter("app", "Google Chrome"),
      formatFieldFilter("host", "api.x.com"),
    ].join(" ");
    expect(text).toBe('@app:"Google Chrome" @host:api.x.com');
    expect(tokenize(text)).toEqual([
      { field: "app", value: "Google Chrome", negated: false },
      { field: "host", value: "api.x.com", negated: false },
    ]);
  });
});

describe("isSystemFlow", () => {
  // The cases `tells_system_daemons_apart` in `flows.rs` checks, so the two agree.
  test("is a daemon outside an app, under the system's folders or by name", () => {
    const sys = (clientPath: string | null, clientBundleId: string | null = null) =>
      isSystemFlow({ clientPath, clientBundleId });
    expect(sys("/usr/libexec/nsurlsessiond")).toBe(true);
    expect(sys("/System/Library/PrivateFrameworks/X.framework/geod")).toBe(true);
    expect(sys("/somewhere/else/trustd")).toBe(true);
    expect(sys("/usr/bin/curl")).toBe(false);
    expect(sys("/opt/homebrew/bin/node")).toBe(false);
    expect(sys("/System/Applications/Music.app", "com.apple.Music")).toBe(false);
    expect(
      sys(
        "/System/Library/Frameworks/WebKit.framework/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking",
      ),
    ).toBe(false);
    expect(sys(null)).toBe(false);
  });
});

describe("siteOf", () => {
  test("is the registrable domain, or the host itself without one", () => {
    expect(siteOf("api.github.com")).toBe("github.com");
    expect(siteOf("www.example.co.uk")).toBe("example.co.uk");
    expect(siteOf("api.stripe.com:8443")).toBe("stripe.com");
    expect(siteOf("localhost:3000")).toBe("localhost");
    expect(siteOf("149.154.175.50")).toBe("149.154.175.50");
  });
});
