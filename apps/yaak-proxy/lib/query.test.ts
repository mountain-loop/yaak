import { describe, expect, test } from "vite-plus/test";
import {
  activeQuery,
  anyCountsBackFromNow,
  asOneTerm,
  countsBackFromNow,
  fieldTerm,
  orGroupShapes,
  pathTerm,
  queryShape,
  termKeys,
  widerQueries,
} from "./query";
import { savedCompletions } from "./searchBox";

describe("terms", () => {
  test("quote values that need it", () => {
    expect(fieldTerm("app", "Google Chrome")).toBe('@app:"Google Chrome"');
    expect(fieldTerm("host", "api.x.com")).toBe("@host:api.x.com");
    expect(fieldTerm("is", "system", true)).toBe("-@is:system");
  });

  test("select a path and what is under it", () => {
    expect(pathTerm("/v1/charges")).toBe("@path:/v1/charges/*");
    expect(pathTerm("/a b")).toBe('@path:"/a b"');
  });

  test("are read back as written, any case, with their exclusion", () => {
    expect(termKeys('@app:"Google Chrome" -@is:System (a OR -b)')).toEqual([
      '@app:"google chrome"',
      "-@is:system",
      "a",
      "-b",
    ]);
    expect(termKeys("")).toEqual([]);
  });

  test("come in the groups `OR` separates at the top, a parenthesised one whole", () => {
    expect(orGroupShapes("@host:x.com @app:Slack OR (a OR b) OR -@is:system")).toEqual([
      "And(@app:slack,@host:x.com)",
      "Or(a,b)",
      "-@is:system",
    ]);
    expect(orGroupShapes("@app:Slack")).toEqual(["@app:slack"]);
    expect(orGroupShapes(" ")).toEqual([]);
  });

  test("have a shape that keeps AND and OR apart, whatever the order or case", () => {
    expect(queryShape("@app:Slack @host:x.com")).toBe(queryShape("@HOST:x.com @app:slack"));
    expect(queryShape("a OR b")).not.toBe(queryShape("a b"));
    expect(queryShape("")).toBeNull();
  });
});

describe("activeQuery", () => {
  test("is null for all traffic, and carries hiding System", () => {
    expect(activeQuery("  ", false)).toBeNull();
    expect(activeQuery("", true)).toEqual({ query: "", hideSystem: true });
    expect(activeQuery(" stripe ", false)).toEqual({ query: "stripe", hideSystem: false });
  });
});

describe("widerQueries", () => {
  test("leaves out each term in turn", () => {
    expect(widerQueries('@app:Slack @status:5xx "card declined"')).toEqual([
      '@status:5xx "card declined"',
      '@app:Slack "card declined"',
      "@app:Slack @status:5xx",
    ]);
    expect(widerQueries("@app:Slack")).toEqual([]);
  });

  test("widens one OR group at a time, keeping the groups", () => {
    const text = "@app:Slack @host:absent.com OR @app:Chrome @host:absent.com";
    expect(widerQueries(text)).toEqual([
      "@host:absent.com OR @app:Chrome @host:absent.com",
      "@app:Slack OR @app:Chrome @host:absent.com",
      "@app:Slack @host:absent.com OR @host:absent.com",
      "@app:Slack @host:absent.com OR @app:Chrome",
    ]);
    // A group of one term is not emptied, which would take in every flow.
    expect(widerQueries("@app:Slack OR @app:Chrome @host:b.com")).toEqual([
      "@app:Slack OR @host:b.com",
      "@app:Slack OR @app:Chrome",
    ]);
  });

  test("keeps groups and exclusions whole", () => {
    expect(widerQueries("(@status:4xx OR @status:5xx) -(a OR b) c")).toEqual([
      "-(a OR b) c",
      "(@status:4xx OR @status:5xx) c",
      "(@status:4xx OR @status:5xx) -(a OR b)",
    ]);
  });
});

describe("countsBackFromNow", () => {
  test("is a @time comparison or range, which ages", () => {
    expect(countsBackFromNow("@time:<5m")).toBe(true);
    expect(countsBackFromNow("x -(@time:[1h TO 2h] OR y)")).toBe(true);
    expect(countsBackFromNow("@time:2026-11-07")).toBe(false);
    expect(countsBackFromNow("@status:<500 time")).toBe(false);
  });

  test("of saved searches, tells when their counts change with time alone", () => {
    expect(anyCountsBackFromNow(["@status:4xx", "-@time:>1h stripe"])).toBe(true);
    expect(anyCountsBackFromNow(["@status:4xx", "@time:2026-11-07"])).toBe(false);
    expect(anyCountsBackFromNow([])).toBe(false);
  });
});

describe("saved searches as completions", () => {
  test("keep an OR at their top in one group, however it is spaced", () => {
    expect(asOneTerm("@status:4xx OR @status:5xx")).toBe("(@status:4xx OR @status:5xx)");
    expect(asOneTerm("(@status:4xx)OR(@status:5xx)")).toBe("((@status:4xx)OR(@status:5xx))");
    expect(asOneTerm("(a OR b) c")).toBe("(a OR b) c");
    const saved = [
      { id: "1", name: "Errors", query: "(@status:4xx)OR(@status:5xx)", sortOrder: 0 },
      { id: "2", name: "Stripe", query: "@host:*.stripe.com", sortOrder: 1 },
    ];
    expect(savedCompletions(saved, "err").map((c) => c.apply)).toEqual([
      "((@status:4xx)OR(@status:5xx))",
    ]);
  });
});
