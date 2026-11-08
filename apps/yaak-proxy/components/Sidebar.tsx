import {
  ContextMenu,
  type DropdownItem,
  Icon,
  IconButton,
  Tree,
  type TreeProps,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useEffect } from "react";
import { useDecryptList, useEditDecryptList } from "../hooks/useDecryptList";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { SIDEBAR_TREE_ID } from "../lib/atoms";
import { blockerOf, decryptMenuAction, isDecrypted, listEdit, setDecrypted } from "../lib/decrypt";
import { applyCollapsed, type CollapsedMap, collapsedMap, folderIds } from "../lib/sidebarCollapse";
import { type SidebarItem, SYSTEM_ID } from "../lib/sidebarTree";
import { hideSystemAtom, noteSidebarInput, sidebarTreeAtom } from "../lib/store";
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
      {item.kind === "tunnelled" && <Icon icon="lock" size="sm" className="text-text-subtle" />}
      {item.kind === "saved" && <Icon icon="bookmark" size="sm" className="text-text-subtle" />}
      {item.kind === "folder" && <Icon icon="folder" size="sm" className="text-text-subtle" />}
      {item.appPath != null && <AppIcon path={item.appPath} />}
      <span className="truncate">{item.label}</span>
      {item.sublabel != null && (
        <span className="truncate text-xs text-text-subtlest">{item.sublabel}</span>
      )}
      {item.decrypt != null && <DecryptedMark item={item} />}
      <Count item={item} />
    </div>
  );
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
    <Icon icon="lock_open" size="xs" title="Decrypted" className="shrink-0 text-text-subtlest" />
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
    // The label too, as a saved search's changes when it is renamed
    (item: SidebarItem) => `${item.id}:${item.count}:${item.countLabel ?? ""}:${item.label}`,
    [],
  );
  const decryptList = useDecryptList();
  const setDecryptList = useEditDecryptList();
  const { mutate: saveDecryptList } = setDecryptList;
  const showToast = useShowToast();
  const setSavedDialog = useSetAtom(savedSearchDialogAtom);
  const { mutate: deleteSaved } = useRpcMutation("delete_saved_query", {
    onError: (err) => showToast({ id: "saved-search", message: err.message, color: "danger" }),
  });

  // Decrypt or Stop Decrypting the selected hosts, sites and apps, from new connections on.
  // A saved search is renamed or deleted.
  const getContextMenu = useCallback(
    (items: SidebarItem[]): DropdownItem[] => {
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
      if (action == null) return [];
      return [
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
    },
    [decryptList, saveDecryptList, showToast, setSavedDialog, deleteSaved],
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
    // search; the tree's own upkeep does not.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- only notes input the tree handles
    <aside
      onPointerDownCapture={noteSidebarInput}
      onKeyDownCapture={noteSidebarInput}
      className="x-theme-sidebar bg-surface h-full w-full min-w-0 grid grid-rows-[minmax(0,1fr)] border-r border-border-subtle"
    >
      <Tree
        treeId={SIDEBAR_TREE_ID}
        collapsedAtom={collapsedAtom}
        className="px-2 pt-2 pb-10"
        root={tree}
        getItemKey={getItemKey}
        ItemInner={ItemInner}
        ItemRightSlot={ItemRightSlot}
        getContextMenu={getContextMenu}
        renderContextMenu={renderContextMenu}
      />
    </aside>
  );
}
