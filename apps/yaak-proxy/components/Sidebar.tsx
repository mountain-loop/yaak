import { Icon, IconButton, Tree } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { atom, useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback } from "react";
import { SIDEBAR_TREE_ID } from "../lib/atoms";
import { applyCollapsed, type CollapsedMap, collapsedMap, folderIds } from "../lib/sidebarCollapse";
import { type SidebarItem, SYSTEM_ID } from "../lib/sidebarTree";
import { hideSystemAtom, sidebarTreeAtom } from "../lib/store";
import { AppIcon } from "./AppIcon";

/** The apps, sites, hosts and paths the user expanded, by node id, kept across launches */
const expandedAtom = atomWithStorage<Record<string, boolean>>("sidebar_expanded", {}, undefined, {
  getOnInit: true,
});

/** The other nodes' collapsed flags, for this launch, as before */
const otherCollapsedAtom = atom<CollapsedMap>({});

/** Every app's tree, site, host and path, and System, collapsed until the user expands them */
const collapsedAtom = atom(
  (get) =>
    collapsedMap(folderIds(get(sidebarTreeAtom)), get(expandedAtom), get(otherCollapsedAtom)),
  (get, set, action: CollapsedMap | ((prev: CollapsedMap) => CollapsedMap)) => {
    const prev = get(collapsedAtom);
    const next = typeof action === "function" ? action(prev) : action;
    const split = applyCollapsed(prev, next, get(expandedAtom), get(otherCollapsedAtom));
    set(expandedAtom, split.expanded);
    set(otherCollapsedAtom, split.others);
  },
);

function Count({ item }: { item: SidebarItem }) {
  const text = item.countLabel ?? (item.count > 0 ? item.count.toLocaleString() : null);
  if (text == null && item.kind !== "all") return null;
  return (
    <span className="ml-auto pl-2 text-text-subtlest text-2xs tabular-nums shrink-0">
      {text ?? "0"}
    </span>
  );
}

function ItemInner({ item }: { item: SidebarItem }) {
  if (item.kind === "group") {
    return (
      <div className="flex items-center gap-2 w-full min-w-0 text-xs text-text-subtlest">
        <span className="truncate">{item.label}</span>
        <Count item={item} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      {item.kind === "all" && <Icon icon="layers" size="sm" className="text-text-subtle" />}
      {item.appPath != null && <AppIcon path={item.appPath} />}
      <span className="truncate">{item.label}</span>
      {item.sublabel != null && (
        <span className="truncate text-xs text-text-subtlest">{item.sublabel}</span>
      )}
      <Count item={item} />
    </div>
  );
}

/** Beside the row's button rather than in it, since it is a button of its own */
function ItemRightSlot({ item }: { item: SidebarItem }) {
  return item.id === SYSTEM_ID ? <HideSystemToggle /> : <span aria-hidden />;
}

/** The eye on System's row, which leaves its daemons out of All traffic */
function HideSystemToggle() {
  const [hidden, setHidden] = useAtom(hideSystemAtom);
  return (
    <IconButton
      size="2xs"
      icon={hidden ? "eye_closed" : "eye"}
      iconColor="secondary"
      title={hidden ? "Show System in All traffic" : "Hide System from All traffic"}
      className={classNames(
        "!h-4 !w-4 mr-1",
        !hidden && "opacity-0 [.tree-item:hover_&]:opacity-100 focus-visible:opacity-100",
      )}
      onClick={(e) => {
        e.stopPropagation();
        setHidden(!hidden);
      }}
    />
  );
}

export function Sidebar() {
  const tree = useAtomValue(sidebarTreeAtom);
  const getItemKey = useCallback(
    (item: SidebarItem) => `${item.id}:${item.count}:${item.countLabel ?? ""}`,
    [],
  );

  return (
    // The tree scrolls itself, in a row of bounded height, so its virtualizer mounts only the rows
    // in view rather than every site, host and path.
    <aside className="x-theme-sidebar bg-surface h-full w-full min-w-0 grid grid-rows-[minmax(0,1fr)] border-r border-border-subtle">
      <Tree
        treeId={SIDEBAR_TREE_ID}
        collapsedAtom={collapsedAtom}
        className="px-2 pt-2 pb-10"
        root={tree}
        getItemKey={getItemKey}
        ItemInner={ItemInner}
        ItemRightSlot={ItemRightSlot}
      />
    </aside>
  );
}
