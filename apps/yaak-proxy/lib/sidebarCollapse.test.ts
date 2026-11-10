import type { TreeNode } from "@yaakapp-internal/ui";
import { describe, expect, test } from "vite-plus/test";
import { applyCollapsed, collapsedMap, folderIds } from "./sidebarCollapse";

/** A node with a children list, empty or not, as the sidebar builds every node */
function node(id: string, children: TreeNode<{ id: string }>[] = []): TreeNode<{ id: string }> {
  return { item: { id }, parent: null, depth: 0, children };
}

const tree = node("root", [
  node("domains", [
    node("host:api.example.com", [
      node("path:api.example.com/v1", [node("path:api.example.com/v1/users")]),
    ]),
    node("host:cdn.example.com", [node("path:cdn.example.com/app.js")]),
    node("host:empty.example.com"),
  ]),
]);

describe("collapsedMap", () => {
  test("collapses every domain and path, and leaves the root and Domains open", () => {
    const map = collapsedMap(folderIds(tree), {}, {});
    // Empty ones too: the tree collapses one before the left arrow moves to its parent.
    expect(map).toEqual({
      "host:api.example.com": true,
      "path:api.example.com/v1": true,
      "path:api.example.com/v1/users": true,
      "host:cdn.example.com": true,
      "path:cdn.example.com/app.js": true,
      "host:empty.example.com": true,
    });
    expect(map.root).toBeUndefined();
    expect(map.domains).toBeUndefined();
  });

  test("collapses every app, site and System, and leaves Apps open", () => {
    const groups = node("root", [
      node("apps", [node("app:Slack", [node("app:Slack|site:slack.com")])]),
      node("domains", [node("site:example.com", [node("host:api.example.com")])]),
      node("system", [node("app:trustd")]),
    ]);
    expect(collapsedMap(folderIds(groups), {}, {})).toEqual({
      "app:Slack": true,
      "app:Slack|site:slack.com": true,
      "site:example.com": true,
      "host:api.example.com": true,
      system: true,
      "app:trustd": true,
    });
  });

  test("opens what the user expanded, and a host seen later starts collapsed", () => {
    const expanded = { "host:api.example.com": true };
    expect(collapsedMap(folderIds(tree), expanded, {})).toMatchObject({
      "host:api.example.com": false,
      "path:api.example.com/v1": true,
      "host:cdn.example.com": true,
    });
    const later = node("root", [
      node("domains", [node("host:new.example.com", [node("path:new.example.com/x")])]),
    ]);
    expect(collapsedMap(folderIds(later), expanded, {})["host:new.example.com"]).toBe(true);
  });
});

describe("applyCollapsed", () => {
  test("keeps an expanded domain, and forgets it when collapsed again", () => {
    const prev = collapsedMap(folderIds(tree), {}, {});
    const opened = applyCollapsed(prev, { ...prev, "host:api.example.com": false }, {}, {});
    expect(opened.expanded).toEqual({ "host:api.example.com": true });

    // Persisted, so the next launch builds the map from it.
    const relaunched = collapsedMap(folderIds(tree), opened.expanded, {});
    expect(relaunched["host:api.example.com"]).toBe(false);

    const closed = applyCollapsed(
      relaunched,
      { ...relaunched, "host:api.example.com": true },
      opened.expanded,
      {},
    );
    expect(closed.expanded).toEqual({});
  });

  test("keeps the other nodes' flags apart from the persisted ones", () => {
    const prev = collapsedMap(folderIds(tree), {}, {});
    const next = applyCollapsed(prev, { ...prev, domains: true }, {}, {});
    expect(next).toEqual({ expanded: {}, others: { domains: true } });
    expect(collapsedMap(folderIds(tree), next.expanded, next.others).domains).toBe(true);
  });
});
