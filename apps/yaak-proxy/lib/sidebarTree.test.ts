import type { Flow } from "@yaakapp-internal/proxy-lib";
import type { TreeNode } from "@yaakapp-internal/ui";
import { describe, expect, test } from "vite-plus/test";
import { parseQuery } from "@yaakapp-internal/query";
import {
  ALL_ID,
  buildSidebarTree,
  exclusiveAll,
  itemsById,
  queryInText,
  rowsForFilter,
  type SidebarItem,
  selectionText,
} from "./sidebarTree";

function flow(url: string, extra: Partial<Flow> = {}): Flow {
  return {
    url,
    method: "GET",
    clientName: null,
    clientBundleId: null,
    clientPath: null,
    clientCwd: null,
    ...extra,
  } as Flow;
}

const slack = { clientName: "Slack", clientBundleId: "com.slack", clientPath: "/A/Slack.app" };
const node = { clientName: "node", clientPath: "/bin/node", clientCwd: "/src/fieldwork" };
const daemon = { clientName: "trustd", clientPath: "/usr/libexec/trustd" };

const flows = [
  flow("https://api.github.com/repos/yaak", node),
  flow("https://github.com/login", node),
  flow("https://edgeapi.slack.com/cache", slack),
  flow("https://ocsp.apple.com/ocsp", daemon),
];

function shape(n: TreeNode<SidebarItem>, depth = 0): string[] {
  const { label, sublabel, count, countLabel } = n.item;
  const line = `${"  ".repeat(depth)}${label}${sublabel ? ` (${sublabel})` : ""} ${countLabel ?? count}`;
  return [line, ...(n.children ?? []).flatMap((c) => shape(c, depth + 1))];
}

describe("buildSidebarTree", () => {
  const root = buildSidebarTree(flows, 40);

  test("groups apps, programs by folder, sites and System", () => {
    expect((root.children ?? []).flatMap((c) => shape(c))).toEqual([
      "All traffic 40",
      "Apps 3",
      "  node (fieldwork) 2",
      "    github.com 2",
      "      api.github.com 1",
      "        /repos 1",
      "          /yaak 1",
      "      github.com 1",
      "        /login 1",
      "  Slack 1",
      "    slack.com 1",
      "      edgeapi.slack.com 1",
      "        /cache 1",
      "Domains 4 hosts",
      "  apple.com 1",
      "    ocsp.apple.com 1",
      "      /ocsp 1",
      "  github.com 2",
      "    api.github.com 1",
      "      /repos 1",
      "        /yaak 1",
      "    github.com 1",
      "      /login 1",
      "  slack.com 1",
      "    edgeapi.slack.com 1",
      "      /cache 1",
      "System 1",
      "  trustd 1",
      "    apple.com 1",
      "      ocsp.apple.com 1",
      "        /ocsp 1",
    ]);
  });

  test("gives each row the query that selects its flows", () => {
    const items = itemsById(root);
    const query = (id: string) => items.get(id)?.query;
    expect(query("all")).toBe("");
    expect(query("app:fieldwork")).toBe("@app:fieldwork");
    // A path row takes in what is under the path.
    expect(query("app:fieldwork|path:api.github.com/repos")).toBe(
      "@app:fieldwork @host:api.github.com @path:/repos/*",
    );
    expect(query("site:github.com")).toBe("@host:*.github.com");
    expect(query("system")).toBe("@is:system");
    // A daemon's rows show its flows while System is hidden from All traffic.
    expect(query("app:trustd")).toBe("@is:system @app:trustd");
    expect(query("app:trustd|host:ocsp.apple.com")).toBe(
      "@is:system @app:trustd @host:ocsp.apple.com",
    );
    // What each writes reads back as the terms it wrote.
    for (const item of items.values()) {
      if (item.kind === "group" || item.kind === "all") continue;
      const parsed = parseQuery(item.query);
      expect(parsed, item.id).toBeTruthy();
      expect(parsed?.type, item.id).not.toBe("Or");
    }
  });
});

describe("programs outside an app", () => {
  const claude = (cwd: string) => ({
    clientName: "claude",
    clientPath: "/usr/local/bin/claude",
    clientCwd: cwd,
  });
  const python = {
    clientName: "python3.12",
    clientPath: "/usr/bin/python3.12",
    clientCwd: "/src/ml",
  };
  const curl = { clientName: "curl", clientPath: "/usr/bin/curl", clientCwd: null };
  const root = buildSidebarTree(
    [
      flow("https://api.anthropic.com/v1/messages", claude("/src/yaak")),
      flow("https://api.anthropic.com/v1/models", claude("/src/fieldwork")),
      flow("https://statsig.anthropic.com/v1", claude("/src/yaak")),
      flow("https://pypi.org/simple", python),
      flow("https://example.com/", curl),
      flow("https://api.github.com/repos", node),
    ],
    6,
  );
  const items = itemsById(root);
  const apps = (root.children ?? []).find((c) => c.item.id === "apps");

  test("one row per program, its working directories one level down above the hosts", () => {
    expect(shape(apps as TreeNode<SidebarItem>).slice(0, 12)).toEqual([
      "Apps 6",
      "  claude 3",
      "    fieldwork 1",
      "      anthropic.com 1",
      "        api.anthropic.com 1",
      "          /v1 1",
      "            /models 1",
      "    yaak 2",
      "      anthropic.com 2",
      "        api.anthropic.com 1",
      "          /v1 1",
      "            /messages 1",
    ]);
  });

  test("generic runtimes keep their folder in the row's name", () => {
    const labels = (apps?.children ?? []).map((c) => [c.item.label, c.item.sublabel ?? null]);
    expect(labels).toEqual([
      ["claude", null],
      ["curl", null],
      ["node", "fieldwork"],
      ["python3.12", "ml"],
    ]);
    // A program with no working directory has its hosts straight under it.
    expect(items.get("app:curl|site:example.com")?.kind).toBe("site");
  });

  test("folder rows carry their full path, and programs their executable", () => {
    expect(items.get("app:claude|cwd:yaak")?.path).toBe("/src/yaak");
    expect(items.get("app:claude|cwd:fieldwork")?.path).toBe("/src/fieldwork");
    expect(items.get("app:claude")?.path).toBe("/usr/local/bin/claude");
    // Hosts and paths under a folder are not on disk.
    expect(items.get("app:claude|cwd:yaak|host:statsig.anthropic.com")?.path).toBeUndefined();
  });

  test("a folder row selects that program in that folder", () => {
    const query = items.get("app:claude|cwd:yaak")?.query ?? "";
    expect(query).toBe("@app:claude @cwd:yaak");
    expect(items.get("app:claude|cwd:yaak|host:statsig.anthropic.com")?.query).toBe(
      "@app:claude @cwd:yaak @host:statsig.anthropic.com",
    );
    expect(parseQuery(query)?.type).toBe("And");
  });
});

test("a row shared by folders or programs in different places names no path", () => {
  const tool = { clientName: "claude", clientPath: "/usr/local/bin/claude" };
  const items = itemsById(
    buildSidebarTree(
      [
        flow("https://a.com/", { ...tool, clientCwd: "/src/yaak" }),
        flow("https://b.com/", { ...tool, clientCwd: "/worktrees/123/yaak" }),
        flow("https://c.com/", { ...tool, clientPath: "/opt/bin/claude", clientCwd: "/src/ml" }),
      ],
      3,
    ),
  );
  expect(items.get("app:claude|cwd:yaak")?.kind).toBe("folder");
  expect(items.get("app:claude|cwd:yaak")?.path).toBeUndefined();
  expect(items.get("app:claude|cwd:ml")?.path).toBe("/src/ml");
  expect(items.get("app:claude")?.path).toBeUndefined();
});

test("an app in a bundle has no path to reveal", () => {
  const items = itemsById(buildSidebarTree([flow("https://slack.com/", slack)], 1));
  expect(items.get("app:Slack")?.path).toBeUndefined();
});

describe("decrypting from the sidebar", () => {
  const tunnel = flow("https://bank.example.com", {
    ...slack,
    method: "CONNECT",
    tunnelled: true,
  });
  const root = buildSidebarTree([...flows, tunnel], 5);
  const items = itemsById(root);

  test("Not decrypted follows All traffic while there are tunnelled flows", () => {
    expect((root.children ?? []).slice(0, 2).map((c) => shape(c)[0])).toEqual([
      "All traffic 5",
      "Not decrypted 1",
    ]);
    expect(items.get("tunnelled")?.query).toBe("@is:tunnelled");
    expect(itemsById(buildSidebarTree(flows, 4)).has("tunnelled")).toBe(false);
  });

  test("hosts, sites and apps name what their menu's Decrypt covers", () => {
    expect(items.get("host:bank.example.com")?.decrypt).toEqual({
      kind: "host",
      host: "bank.example.com",
    });
    expect(items.get("site:example.com")?.decrypt).toEqual({ kind: "site", site: "example.com" });
    expect(items.get("app:Slack|host:edgeapi.slack.com")?.decrypt).toEqual({
      kind: "host",
      host: "edgeapi.slack.com",
    });
    expect(items.get("app:Slack")?.decrypt).toEqual({
      kind: "app",
      name: "Slack",
      bundleId: "com.slack",
    });
    expect(items.get("path:api.github.com/repos")?.decrypt).toBeUndefined();
    expect(items.get("domains")?.decrypt).toBeUndefined();
  });
});

describe("selection and the search text", () => {
  test("selects rows under different apps as groups of their own", () => {
    const items = itemsById(buildSidebarTree(flows, 4));
    const pick = (id: string) => items.get(id) as SidebarItem;
    const text = selectionText([
      pick("app:fieldwork|host:api.github.com"),
      pick("app:Slack|site:slack.com"),
    ]);
    expect(text).toBe("@app:fieldwork @host:api.github.com OR @app:Slack @host:*.slack.com");
    // Two groups, each judged whole
    const parsed = parseQuery(text);
    expect(parsed?.type).toBe("Or");
    expect(parsed?.type === "Or" ? parsed.children.map((c) => c.type) : []).toEqual(["And", "And"]);
  });

  test("writes the selected rows' queries, OR'd, or nothing for All traffic", () => {
    const a = { query: "@app:Slack" } as SidebarItem;
    const b = { query: "@host:*.github.com" } as SidebarItem;
    const all = { query: "" } as SidebarItem;
    expect(selectionText([a])).toBe("@app:Slack");
    expect(selectionText([a, b])).toBe("@app:Slack OR @host:*.github.com");
    expect(selectionText([a, all])).toBe("");
  });

  test("puts a saved search with `OR` of its own in parentheses beside other rows", () => {
    const saved = { query: "@status:5xx OR @status:4xx" } as SidebarItem;
    const host = { query: "@host:*.github.com" } as SidebarItem;
    expect(selectionText([saved, host])).toBe("(@status:5xx OR @status:4xx) OR @host:*.github.com");
    expect(selectionText([saved])).toBe("@status:5xx OR @status:4xx");
  });

  test("All traffic is selected alone, whichever was chosen last", () => {
    expect(exclusiveAll(["a", ALL_ID], ["a"])).toEqual([ALL_ID]);
    expect(exclusiveAll([ALL_ID, "a"], [ALL_ID])).toEqual(["a"]);
    const rows = ["a", "b"];
    expect(exclusiveAll(rows, ["a"])).toBe(rows);
    expect(exclusiveAll([ALL_ID], ["a"])).toEqual([ALL_ID]);
  });

  test("a filter keeps the rows still in it, and finds those whose query is a group of it", () => {
    const items = itemsById(buildSidebarTree(flows, 4));
    const github = "app:fieldwork|host:api.github.com";
    const slack = "app:Slack|site:slack.com";
    const both = selectionText([items.get(github), items.get(slack)] as SidebarItem[]);

    // Applied from the box: kept while in it, dropped once not, none added.
    expect(rowsForFilter(`${both} card`, [github, slack], items, false)).toEqual([github, slack]);
    expect(rowsForFilter("@app:Slack @host:*.slack.com", [github, slack], items, false)).toEqual([
      slack,
    ]);
    // Gone back to, the rows that wrote it are found again, from none selected.
    expect(rowsForFilter(both, [], items, true).sort()).toEqual([github, slack].sort());
    // A group that is only part of a row's query finds nothing.
    expect(rowsForFilter("@app:Slack", [], items, true)).not.toContain(slack);
    expect(rowsForFilter(" ", [github], items, true)).toEqual([ALL_ID]);
  });

  test("a row is found only by a group that says what its query says", () => {
    const either = { id: "saved:either", kind: "saved", query: "@method:GET OR @host:x.com" };
    const system = { id: "system", kind: "group", query: "@is:system" };
    const items = new Map([either, system].map((i) => [i.id, i as SidebarItem]));
    // Both terms, but together rather than either
    expect(rowsForFilter("@method:GET @host:x.com", [], items, true)).toEqual([]);
    expect(rowsForFilter("(@method:GET OR @host:x.com) OR @app:a", [], items, true)).toEqual([
      "saved:either",
    ]);
    // A heading with a query of its own, as System's, is found as any row is.
    expect(rowsForFilter("@is:system", [], items, true)).toEqual(["system"]);
  });

  test("keeps a row selected while every term of its query is in the text", () => {
    expect(queryInText("@app:Slack", "@app:Slack card")).toBe(true);
    expect(queryInText("@app:slack", "@app:Slack")).toBe(true);
    expect(queryInText("@app:Slack @host:x.com", "@app:Slack")).toBe(false);
    expect(queryInText("", "")).toBe(true);
    expect(queryInText("", "card")).toBe(false);
  });
});

describe("saved searches", () => {
  test("follow All traffic, each a row with its count that writes its query", () => {
    const saved = [
      { id: "sq_1", name: "Errors", query: "@status:>=400", count: 12 },
      { id: "sq_2", name: "Stripe", query: "@host:*.stripe.com", count: 0 },
    ];
    const root = buildSidebarTree(flows, 4, saved);
    expect((root.children ?? []).slice(0, 2).flatMap((c) => shape(c))).toEqual([
      "All traffic 4",
      "Saved 0",
      "  Errors 12",
      "  Stripe 0",
    ]);
    const items = itemsById(root);
    expect(items.get("saved:sq_1")).toMatchObject({
      kind: "saved",
      query: "@status:>=400",
      savedId: "sq_1",
    });
    // Rows, not folders
    const group = (root.children ?? []).find((c) => c.item.id === "saved");
    expect(group?.children?.every((c) => c.children == null)).toBe(true);
    expect(itemsById(buildSidebarTree(flows, 4)).has("saved")).toBe(false);
  });
});
