import type { TreeNode } from "@yaakapp-internal/ui";
import { describe, expect, test } from "vite-plus/test";
import { applyCollapsed, collapsedMap, folderIds } from "./sidebarCollapse";

/** A node with these children, which `folderIds` counts as a folder when there are any */
function node(id: string, children: TreeNode<{ id: string }>[] = []): TreeNode<{ id: string }> {
  return { item: { id }, parent: null, depth: 0, children };
}

const tree = node("root", [
  node("domains", [
    node("domain:api.example.com", [
      node("path:api.example.com/v1", [node("path:api.example.com/v1/users")]),
    ]),
    node("domain:cdn.example.com", [node("path:cdn.example.com/app.js")]),
    // A host only ever hit at its root has no paths, so nothing to collapse.
    node("domain:empty.example.com"),
  ]),
]);

describe("collapsedMap", () => {
  test("collapses every domain and path, and leaves the root and Domains open", () => {
    const map = collapsedMap(folderIds(tree), {}, {});
    expect(map).toEqual({
      "domain:api.example.com": true,
      "path:api.example.com/v1": true,
      "domain:cdn.example.com": true,
    });
    expect(map.root).toBeUndefined();
    expect(map.domains).toBeUndefined();
  });

  test("opens what the user expanded, and a host seen later starts collapsed", () => {
    const expanded = { "domain:api.example.com": true };
    expect(collapsedMap(folderIds(tree), expanded, {})).toMatchObject({
      "domain:api.example.com": false,
      "path:api.example.com/v1": true,
      "domain:cdn.example.com": true,
    });
    const later = node("root", [
      node("domains", [node("domain:new.example.com", [node("path:new.example.com/x")])]),
    ]);
    expect(collapsedMap(folderIds(later), expanded, {})["domain:new.example.com"]).toBe(true);
  });
});

describe("applyCollapsed", () => {
  test("keeps an expanded domain, and forgets it when collapsed again", () => {
    const prev = collapsedMap(folderIds(tree), {}, {});
    const opened = applyCollapsed(prev, { ...prev, "domain:api.example.com": false }, {}, {});
    expect(opened.expanded).toEqual({ "domain:api.example.com": true });

    // Persisted, so the next launch builds the map from it.
    const relaunched = collapsedMap(folderIds(tree), opened.expanded, {});
    expect(relaunched["domain:api.example.com"]).toBe(false);

    const closed = applyCollapsed(
      relaunched,
      { ...relaunched, "domain:api.example.com": true },
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
