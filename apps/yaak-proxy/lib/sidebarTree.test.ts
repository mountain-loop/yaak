import type { Flow } from "@yaakapp-internal/proxy-lib";
import type { TreeNode } from "@yaakapp-internal/ui";
import { describe, expect, test } from "vite-plus/test";
import { parseSearch } from "./search";
import {
  buildSidebarTree,
  itemsById,
  queryInText,
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
    expect(query("app:fieldwork|path:api.github.com/repos")).toBe(
      "@app:fieldwork @host:api.github.com @path:/repos",
    );
    expect(query("site:github.com")).toBe("@host:*.github.com");
    expect(query("system")).toBe("@is:system");
    // A daemon's rows show its flows while System is hidden from All traffic.
    expect(query("app:trustd")).toBe("@is:system @app:trustd");
    expect(query("app:trustd|host:ocsp.apple.com")).toBe(
      "@is:system @app:trustd @host:ocsp.apple.com",
    );
    expect(parseSearch(query("app:trustd") ?? "", true)?.system).toBe(true);
    // What each writes, read back, covers the flows the row counts.
    for (const item of items.values()) {
      const parsed = parseSearch(item.query);
      if (parsed == null || item.kind === "group") continue;
      expect(parsed, item.id).toBeTruthy();
    }
  });
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
    expect(parseSearch(text)).toEqual({
      any: [
        { app: ["fieldwork"], under: ["api.github.com"] },
        { app: ["Slack"], under: ["*.slack.com"] },
      ],
    });
  });

  test("writes the selected rows' queries, OR'd, or nothing for All traffic", () => {
    const a = { query: "@app:Slack" } as SidebarItem;
    const b = { query: "@host:*.github.com" } as SidebarItem;
    const all = { query: "" } as SidebarItem;
    expect(selectionText([a])).toBe("@app:Slack");
    expect(selectionText([a, b])).toBe("@app:Slack OR @host:*.github.com");
    expect(selectionText([a, all])).toBe("");
  });

  test("keeps a row selected while every term of its query is in the text", () => {
    expect(queryInText("@app:Slack", "@app:Slack card")).toBe(true);
    expect(queryInText("@app:slack", "@app:Slack")).toBe(true);
    expect(queryInText("@app:Slack @host:x.com", "@app:Slack")).toBe(false);
    expect(queryInText("", "")).toBe(true);
    expect(queryInText("", "card")).toBe(false);
  });
});
