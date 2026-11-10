import {
  ContextMenu,
  CONTROL_TOOLTIP_DELAY,
  type DropdownItem,
  Icon,
  Tooltip,
  Tree,
  type TreeProps,
} from "@yaakapp-internal/ui";
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { type PointerEvent, type SyntheticEvent, useCallback, useEffect } from "react";
import { useDecryptList, useEditDecryptList } from "../hooks/useDecryptList";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { appliedFilterAtom, SIDEBAR_TREE_ID } from "../lib/atoms";
import { blockerOf, decryptMenuAction, isDecrypted, listEdit, setDecrypted } from "../lib/decrypt";
import { revealLabel, revealPath } from "../lib/opener";
import { applyCollapsed, type CollapsedMap, collapsedMap, folderIds } from "../lib/sidebarCollapse";
import {
  copyRowsText,
  filterWithRows,
  type SidebarItem,
  SYSTEM_ID,
  valueRows,
} from "../lib/sidebarTree";
import { applyFilter, noteSidebarInput, noteSidebarMenu } from "../lib/navigation";
import { hideSystemAtom, sidebarTreeAtom } from "../lib/store";
import { getOsType } from "../lib/tauri";
import { useShowToast } from "../lib/toast";
import { AppIcon } from "./AppIcon";
import { savedSearchDialogAtom } from "./SavedSearchDialog";

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
  const text = item.count > 0 ? item.count.toLocaleString() : null;
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
      {item.kind === "tunnelled" && <Icon icon="lock" size="sm" className="text-text-subtle" />}
      {item.kind === "saved" && <Icon icon="bookmark" size="sm" className="text-text-subtle" />}
      {item.kind === "folder" && <Icon icon="folder" size="sm" className="text-text-subtle" />}
      {item.appPath != null && <AppIcon path={item.appPath} className="size-[1.125rem]" />}
      {item.kind === "folder" && item.path != null ? (
        // Named by its last part; the whole path on hover
        <Tooltip wrap content={item.path} delay={CONTROL_TOOLTIP_DELAY}>
          <span className="truncate">{item.label}</span>
        </Tooltip>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
      {item.sublabel != null && (
        <span className="truncate text-xs text-text-subtlest">{item.sublabel}</span>
      )}
      {item.decrypt != null && <DecryptedMark item={item} />}
      <Count item={item} />
    </div>
  );
}

/** Input in the sidebar itself, not in a row's menu, whose events reach it through its portal */
function inSidebar(e: SyntheticEvent<HTMLElement>): boolean {
  return e.target instanceof Node && e.currentTarget.contains(e.target);
}

/** A press that opens a context menu: the secondary button, or Control and a click on macOS */
function opensMenu(e: PointerEvent<HTMLElement>): boolean {
  return e.button !== 0 || (e.ctrlKey && getOsType() === "macos");
}

/** The menu's sections that have items, a separator between each */
function withSeparators(sections: DropdownItem[][]): DropdownItem[] {
  return sections
    .filter((s) => s.some((i) => !i.hidden))
    .flatMap((s, n) => (n === 0 ? s : [{ type: "separator" } as const, ...s]));
}

/** A row with nothing in its menu: the menu closes as it opens, so the row is not left marked */
function CloseAtOnce({ onClose }: { onClose: () => void }) {
  useEffect(() => onClose(), [onClose]);
  return null;
}

/** A small open lock on a host, site or app the decrypt list decrypts */
function DecryptedMark({ item }: { item: SidebarItem }) {
  const list = useDecryptList();
  if (item.decrypt == null || !isDecrypted(list, item.decrypt)) return null;
  return (
    <Tooltip wrap content="Decrypted" delay={CONTROL_TOOLTIP_DELAY}>
      <Icon icon="lock_open" size="xs" className="shrink-0 text-text-subtlest" />
    </Tooltip>
  );
}

export function Sidebar() {
  const store = useStore();
  const tree = useAtomValue(sidebarTreeAtom);
  const getItemKey = useCallback(
    // The label too, as a saved search's changes when it is renamed
    (item: SidebarItem) => `${item.id}:${item.count}:${item.label}`,
    [],
  );
  const [hideSystem, setHideSystem] = useAtom(hideSystemAtom);
  const decryptList = useDecryptList();
  const setDecryptList = useEditDecryptList();
  const { mutate: saveDecryptList } = setDecryptList;
  const showToast = useShowToast();
  const setSavedDialog = useSetAtom(savedSearchDialogAtom);
  const { mutate: deleteSaved } = useRpcMutation("delete_saved_query", {
    onError: (err) => showToast({ id: "saved-search", message: err.message, color: "danger" }),
  });

  // A program's folder, or the program, is shown in Finder, and a folder's path copied.
  const fail = useCallback(
    (message: string) => showToast({ id: "sidebar-path", message, color: "danger" }),
    [showToast],
  );
  const pathItems = useCallback(
    (item: SidebarItem | undefined): DropdownItem[] => {
      const path = item?.path;
      if (item == null || path == null) return [];
      return [
        {
          label: revealLabel(getOsType()),
          leftSlot: <Icon icon="folder_open" />,
          onSelect: () => void revealPath(path, fail),
        },
        {
          label: "Copy path",
          leftSlot: <Icon icon="copy" />,
          hidden: item.kind !== "folder",
          onSelect: () => {
            navigator.clipboard.writeText(path).catch((err) => fail(String(err)));
          },
        },
      ];
    },
    [fail],
  );

  // The selected apps, folders, sites, hosts and paths added to the filter, either way, at once,
  // or their values copied, as a cell's menu in the list does.
  const filterItems = useCallback(
    (items: SidebarItem[]): DropdownItem[] => {
      if (valueRows(items).length === 0) return [];
      const add = (negated: boolean) =>
        applyFilter(store, filterWithRows(store.get(appliedFilterAtom), items, negated));
      return [
        { label: "Filter by This Value", icon: "filter", onSelect: () => add(false) },
        { label: "Exclude This Value", icon: "minus_circle", onSelect: () => add(true) },
        {
          label: "Copy Value",
          icon: "copy",
          onSelect: async () => {
            try {
              await navigator.clipboard.writeText(copyRowsText(items));
              showToast({ message: "Copied value" });
            } catch (err) {
              showToast({ message: `Failed to copy value: ${String(err)}`, color: "danger" });
            }
          },
        },
      ];
    },
    [store, showToast],
  );

  // Filter by the selected rows, Decrypt or Stop Decrypting the selected hosts, sites and apps,
  // from new connections on, then a program's folder. A saved search is renamed or deleted, and
  // System is shown in All traffic or left out of it.
  const getContextMenu = useCallback(
    (items: SidebarItem[]): DropdownItem[] => {
      if (items.length === 1 && items[0]?.id === SYSTEM_ID) {
        return [
          {
            label: "Show in All Traffic",
            leftSlot: hideSystem ? (
              <span aria-hidden className="inline-block w-4 h-4" />
            ) : (
              <Icon icon="check" size="sm" />
            ),
            onSelect: () => setHideSystem(!hideSystem),
          },
        ];
      }
      const paths = items.length === 1 ? pathItems(items[0]) : [];
      const saved = items.flatMap((i) => (i.savedId == null ? [] : [{ ...i, id: i.savedId }]));
      if (saved.length > 0) {
        const [first] = saved;
        return [
          {
            label: "Rename",
            leftSlot: <Icon icon="pencil" />,
            hidden: saved.length > 1 || first == null,
            onSelect: () => {
              if (first != null)
                setSavedDialog({ mode: "rename", id: first.id, name: first.label });
            },
          },
          {
            label: "Delete",
            color: "danger",
            leftSlot: <Icon icon="trash" />,
            onSelect: () => {
              for (const s of saved) deleteSaved({ id: s.id });
            },
          },
        ];
      }
      const subjects = items.flatMap((i) => (i.decrypt == null ? [] : [i.decrypt]));
      const action = decryptMenuAction(decryptList, subjects);
      const decrypt: DropdownItem[] =
        action == null
          ? []
          : [
              {
                label: action.label,
                icon: action.on ? "lock_open" : "lock",
                onSelect: () => {
                  const blocked = action.on ? blockerOf(decryptList, subjects) : null;
                  if (blocked != null) {
                    showToast({
                      id: "decrypt-blocked",
                      color: "notice",
                      message: `Excluded by ${blocked}`,
                    });
                    return;
                  }
                  // Only what this changes, applied to the list as it is then, so a second change
                  // made before this one lands keeps it.
                  const next = setDecrypted(decryptList, subjects, action.on);
                  saveDecryptList(listEdit(decryptList, next));
                },
              },
            ];
      return withSeparators([filterItems(items), decrypt, paths]);
    },
    [
      decryptList,
      saveDecryptList,
      showToast,
      setSavedDialog,
      deleteSaved,
      pathItems,
      filterItems,
      hideSystem,
      setHideSystem,
    ],
  );
  const renderContextMenu = useCallback<NonNullable<TreeProps<SidebarItem>["renderContextMenu"]>>(
    ({ items, position, onClose }) =>
      items.length === 0 ? (
        <CloseAtOnce onClose={onClose} />
      ) : (
        <ContextMenu items={items as DropdownItem[]} triggerPosition={position} onClose={onClose} />
      ),
    [],
  );

  return (
    // The tree scrolls itself, in a row of bounded height, so its virtualizer mounts only the rows
    // in view rather than every site, host and path.
    // A click or key here marks the selection change it makes as the person's, so it writes the
    // search; the tree's own upkeep does not. Opening a row's menu selects it too, but leaves the
    // search as it is, for the menu's Filter by This Value to add to, and the rows as it says.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- only notes input the tree handles
    <aside
      onPointerDownCapture={(e) => {
        if (!inSidebar(e)) return;
        if (opensMenu(e)) noteSidebarMenu();
        else noteSidebarInput();
      }}
      onKeyDownCapture={(e) => {
        if (inSidebar(e)) noteSidebarInput();
      }}
      className="x-theme-sidebar bg-surface h-full w-full min-w-0 grid grid-rows-[minmax(0,1fr)] border-r border-border-subtle"
    >
      <Tree
        treeId={SIDEBAR_TREE_ID}
        collapsedAtom={collapsedAtom}
        className="px-2 pt-2 pb-10"
        root={tree}
        getItemKey={getItemKey}
        ItemInner={ItemInner}
        getContextMenu={getContextMenu}
        renderContextMenu={renderContextMenu}
      />
    </aside>
  );
}
