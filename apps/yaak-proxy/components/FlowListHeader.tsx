import {
  DndContext,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { FlowSortKey } from "@yaakapp-internal/proxy-lib";
import {
  ContextMenu,
  Dropdown,
  type DropdownItem,
  Icon,
  IconButton,
  ResizeHandle,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue, useSetAtom } from "jotai";
import {
  memo,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  addSortKey,
  allColumns,
  type Column,
  type ColumnDef,
  type ColumnId,
  type ColumnPrefs,
  type CustomColumnId,
  canHide,
  dropBoundary,
  hideOtherColumns,
  isCustomColumn,
  moveColumn,
  moveColumnBy,
  removeCustomColumn,
  resetOrder,
  resetWidth,
  resetWidths,
  resizeColumn,
  resizeDistance,
  toggleColumn,
  unavailableColumns,
} from "../lib/columns";
import { columnPrefsAtom, hasAppsAtom } from "../lib/store";
import { addColumnDialogAtom } from "./AddColumnDialog";

/** Pixels a press on a label moves before it drags the column rather than sorting by it */
const DRAG_DISTANCE = 4;
/** How near the list's side edge, in pixels, a dragged column scrolls the list that way */
const EDGE = 40;
/** The most the list scrolls sideways a frame, at the very edge */
const EDGE_SPEED = 18;

interface Props {
  columns: Column[];
  template: string;
  /** The rows' width, as CSS, so the header scrolls sideways with them */
  width: string;
  prefs: ColumnPrefs;
  sort: FlowSortKey[];
  /** A click on a label, or with `add`, an Option-click */
  onSort: (column: ColumnId, add: boolean) => void;
  /** Sets the sort from the menus; empty goes back to arrival order */
  onSetSort: (sort: FlowSortKey[]) => void;
  onResetSort: () => void;
  /** The rows' scrolling element, which a column dragged to its edge scrolls sideways */
  scrollElement: () => HTMLElement | null;
  /** A column's drag, for the list to show: its ghost, and the columns making room for it */
  onColumnDrag: (event: ColumnDragEvent) => void;
}

/**
 * A column's drag: its start, the pointer's moves (`x`, across the window), the boundary it
 * would drop at when that changes (`to`, null where it would stay), and its end, dropped there
 * or put back
 */
export type ColumnDragEvent =
  | { type: "start"; id: ColumnId; x: number }
  | { type: "move"; x: number }
  | { type: "target"; to: number | null }
  | { type: "end"; dropped: boolean };

/**
 * The list's only control surface: a click on a label sorts by it alone, a second reverses it
 * and a third goes back to arrival order; Option-click adds it to the sort as a further key.
 * Dragging a label moves its column, and Escape puts it back. Dragging the edge after a label
 * resizes its column and a double-click on it resets it. A right-click on a label opens the
 * column's menu; the picker sits in the empty corner on hover.
 */
export const FlowListHeader = memo(function FlowListHeader({
  columns,
  template,
  width,
  prefs,
  sort,
  onSort,
  onSetSort: setSort,
  onResetSort,
  scrollElement,
  onColumnDrag,
}: Props) {
  const setPrefs = useSetAtom(columnPrefsAtom);
  const unavailable = unavailableColumns(useAtomValue(hasAppsAtom));
  const openAddColumn = useSetAtom(addColumnDialogAtom);
  const [menu, setMenu] = useState<{ x: number; y: number; column: ColumnDef | null } | null>(null);
  // Widths when a drag began, so each move sets the width from where it started.
  const startWidth = useRef(0);
  const { sensors, dndHandlers, gridRef, onPointerDownCapture } = useColumnDrag({
    columns,
    scrollElement,
    onColumnDrag,
    onDrop: (id, to) => setPrefs((p) => moveColumn(p, id, to, unavailable)),
  });

  // Taking out the sort's only key goes back to arrival order, as Reset Sort does
  const removeColumn = (id: CustomColumnId) => {
    if (sort.length > 0 && sort.every((k) => k.column === id)) onResetSort();
    setPrefs((p) => removeCustomColumn(p, id));
  };

  const pickerItems: DropdownItem[] = [
    {
      type: "content",
      label: <div className="px-1.5 pt-1 text-xs text-text-subtlest">Columns</div>,
    },
    ...allColumns(prefs).map((c): DropdownItem => {
      const shown = prefs.visible[c.id] ?? c.defaultVisible;
      return {
        label: c.label,
        keepOpenOnSelect: true,
        disabled: shown && !canHide(prefs, c.id, unavailable),
        leftSlot: shown ? (
          <Icon icon="check" size="sm" />
        ) : (
          <span aria-hidden className="inline-block w-4 h-4" />
        ),
        onSelect: () => setPrefs((p) => toggleColumn(p, c.id, unavailable)),
        ...(isCustomColumn(c.id)
          ? {
              submenuTrigger: "button" as const,
              submenu: [
                {
                  label: "Remove Column",
                  icon: "trash" as const,
                  color: "danger" as const,
                  onSelect: () => removeColumn(c.id as CustomColumnId),
                },
              ],
            }
          : {}),
      };
    }),
    { label: "Add Column…", icon: "plus", onSelect: () => openAddColumn(true) },
    { type: "separator" },
    { label: "Reset Sort", disabled: sort.length === 0, onSelect: onResetSort },
    { label: "Reset Column Widths", onSelect: () => setPrefs((p) => resetWidths(p)) },
    {
      label: "Reset Column Order",
      disabled: prefs.order.length === 0,
      onSelect: () => setPrefs((p) => resetOrder(p)),
    },
  ];

  const columnItems = (c: ColumnDef): DropdownItem[] => {
    const sortBy = (descending: boolean) => setSort([{ column: c.id, descending }]);
    const addTo = (descending: boolean) => setSort(addSortKey(sort, c.id, descending));
    const at = columns.findIndex((col) => col.id === c.id);
    return [
      { label: "Sort Ascending", onSelect: () => sortBy(false) },
      { label: "Sort Descending", onSelect: () => sortBy(true) },
      { label: "Add to Sort Ascending", onSelect: () => addTo(false) },
      { label: "Add to Sort Descending", onSelect: () => addTo(true) },
      { label: "Clear Sorting", disabled: sort.length === 0, onSelect: onResetSort },
      { type: "separator" },
      {
        label: "Move Left",
        disabled: at <= 0,
        onSelect: () => setPrefs((p) => moveColumnBy(p, c.id, -1, unavailable)),
      },
      {
        label: "Move Right",
        disabled: at === -1 || at >= columns.length - 1,
        onSelect: () => setPrefs((p) => moveColumnBy(p, c.id, 1, unavailable)),
      },
      { type: "separator" },
      {
        label: "Hide Column",
        disabled: !canHide(prefs, c.id, unavailable),
        onSelect: () => setPrefs((p) => toggleColumn(p, c.id, unavailable)),
      },
      {
        label: "Hide Other Columns",
        disabled: columns.length <= 1,
        onSelect: () => setPrefs((p) => hideOtherColumns(p, c.id)),
      },
      ...(isCustomColumn(c.id)
        ? [
            {
              label: "Remove Column",
              color: "danger" as const,
              onSelect: () => removeColumn(c.id as CustomColumnId),
            },
          ]
        : []),
      { type: "separator" },
      { label: "Reset Column Widths", onSelect: () => setPrefs((p) => resetWidths(p)) },
    ];
  };

  // A right-click on a label is for its column; anywhere else in the header, the picker.
  const openMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-column]");
      const id = el?.dataset.column as ColumnId | undefined;
      const column = columns.find((c) => c.id === id) ?? null;
      setMenu({ x: e.clientX, y: e.clientY, column });
    },
    [columns],
  );

  return (
    // The same margins and padding as the rows, so each label sits over its cells.
    <div style={{ width, minWidth: "100%" }} className="px-1.5">
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a right-click opens the column's menu */}
      <div
        ref={gridRef}
        data-flow-header
        onPointerDownCapture={onPointerDownCapture}
        onContextMenu={openMenu}
        style={{ gridTemplateColumns: template }}
        className={classNames(
          "group/header grid items-center h-xs px-1.5 select-none",
          "text-xs text-text-subtlest border-b border-border-subtle",
        )}
      >
        <span className="flex items-center justify-center">
          <Dropdown items={pickerItems}>
            <IconButton
              size="xs"
              icon="settings_2"
              title="Columns"
              tooltip
              iconColor="secondary"
              className="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 !h-5 !w-5"
            />
          </Dropdown>
        </span>
        <DndContext sensors={sensors} autoScroll={false} {...dndHandlers}>
          {columns.map((c) => (
            <HeaderCell
              key={c.id}
              column={c}
              sort={sort}
              onSort={onSort}
              onResizeStart={() => {
                startWidth.current = c.current;
              }}
              onResizeMove={(dx) => {
                const by = resizeDistance(c, dx, rootFontSize());
                setPrefs((p) => resizeColumn(p, c.id, startWidth.current + by));
              }}
              onResetWidth={() => setPrefs((p) => resetWidth(p, c.id))}
            />
          ))}
        </DndContext>
        <ContextMenu
          triggerPosition={menu}
          items={menu == null ? [] : menu.column == null ? pickerItems : columnItems(menu.column)}
          onClose={() => setMenu(null)}
        />
      </div>
    </div>
  );
});

/** The interface font size now, which numeric columns' widths grow with */
function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
}

interface HeaderCellProps {
  column: Column;
  sort: FlowSortKey[];
  onSort: (column: ColumnId, add: boolean) => void;
  onResizeStart: () => void;
  /** How far the edge moved since the resize began */
  onResizeMove: (dx: number) => void;
  onResetWidth: () => void;
}

function HeaderCell({
  column: c,
  sort,
  onSort,
  onResizeStart,
  onResizeMove,
  onResetWidth,
}: HeaderCellProps) {
  // The label drags the column; the resize handle beside it is outside it, so it still resizes.
  const { listeners, setNodeRef } = useDraggable({ id: c.id });
  const sorted = sort.some((k) => k.column === c.id);
  return (
    <span data-column={c.id} className="relative h-full flex items-center min-w-0 px-1.5">
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        // A press that moves drags instead; dnd-kit swallows the click that ends a drag.
        onClick={(e) => onSort(c.id, e.altKey)}
        // No tooltip: the header sits under the search field, and a tooltip here covered it
        aria-label={`Sort by ${c.label}`}
        className={classNames(
          "flex items-center gap-0.5 min-w-0 w-full h-full whitespace-nowrap",
          "hover:text-text-subtle",
          c.align === "right" && "justify-end",
          sorted && "text-text-subtle",
        )}
      >
        <ColumnLabel column={c} sort={sort} />
      </button>
      {/* On the column's right edge, the boundary with the next, resizing this one */}
      <ResizeHandle
        side="right"
        justify="center"
        className="absolute top-0 translate-x-1/2"
        onResizeStart={onResizeStart}
        onResizeMove={(e) => onResizeMove(e.x - e.xStart)}
        onReset={onResetWidth}
      />
    </span>
  );
}

/** A column's name, after its sort direction and, sorted by several, its place in the sort */
function ColumnLabel({ column: c, sort }: { column: Column; sort: FlowSortKey[] }) {
  const at = sort.findIndex((k) => k.column === c.id);
  const key = sort[at];
  return (
    <>
      {key != null && (
        <Icon
          icon="chevron_down"
          size="xs"
          className={classNames("shrink-0", !key.descending && "rotate-180")}
        />
      )}
      {key != null && sort.length > 1 && (
        <span className="shrink-0 -ml-0.5 text-2xs tabular-nums">{at + 1}</span>
      )}
      <span className="truncate">{c.id === "app" ? "" : c.label}</span>
    </>
  );
}

/**
 * Dragging a column's label: where it would drop, the boundary between the labels nearest the
 * pointer as they were laid out when the drag began, and the list scrolling sideways while the
 * pointer is near its edge. The list shows the drag; the columns only change order on the drop,
 * so the rows lay out once.
 */
function useColumnDrag({
  columns,
  scrollElement,
  onColumnDrag,
  onDrop,
}: {
  columns: Column[];
  scrollElement: () => HTMLElement | null;
  onColumnDrag: (event: ColumnDragEvent) => void;
  /** Moves the column to the boundary `to` between those shown */
  onDrop: (id: ColumnId, to: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
  );
  const gridRef = useRef<HTMLDivElement>(null);
  // Live while dragging, read each frame
  const state = useRef<{
    /** The column dragged, and its place among those shown */
    id: ColumnId;
    from: number;
    /** The labels' edges when the drag began, from the header's left, as the columns slide */
    cells: { left: number; right: number }[];
    /** The columns shown when it began, which the edges and `from` describe */
    shown: string;
    /** The pointer, across the window */
    x: number;
    /** The boundary it would move to, null where it would stay */
    to: number | null;
    /** The pointer the ghost was last moved to */
    ghostX: number;
    frame: number;
  } | null>(null);
  const latest = useRef({ columns, scrollElement, onColumnDrag, onDrop });
  useLayoutEffect(() => {
    latest.current = { columns, scrollElement, onColumnDrag, onDrop };
  });

  /** Ends the drag, dropped or put back */
  const stop = useCallback((dropped: boolean) => {
    const s = state.current;
    state.current = null;
    if (s == null) return null;
    cancelAnimationFrame(s.frame);
    latest.current.onColumnDrag({ type: "end", dropped });
    return s;
  }, []);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const grid = gridRef.current;
    const from = latest.current.columns.findIndex((c) => c.id === e.active.id);
    if (grid == null || from === -1) return;
    const id = e.active.id as ColumnId;
    const x = pointer.current;
    // First, as it ends the last drag's columns sliding home, so the edges read below are where
    // the columns are laid out, not where they were sliding
    latest.current.onColumnDrag({ type: "start", id, x });
    const gridLeft = grid.getBoundingClientRect().left;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(":scope > [data-column]")).map(
      (el) => {
        const box = el.getBoundingClientRect();
        return { left: box.left - gridLeft, right: box.right - gridLeft };
      },
    );
    const shown = shownKey(latest.current.columns);
    state.current = { id, from, cells, shown, x, to: null, ghostX: x, frame: 0 };
    target(state.current);

    const tick = () => {
      const s = state.current;
      if (s == null) return;
      // Near an edge, the list scrolls that way, faster the nearer; the header follows it.
      const list = latest.current.scrollElement();
      if (list != null) {
        const { left, right } = list.getBoundingClientRect();
        const near =
          s.x < left + EDGE ? s.x - left - EDGE : s.x > right - EDGE ? s.x - right + EDGE : 0;
        if (near !== 0) {
          const speed = Math.min(1, Math.abs(near) / EDGE) * EDGE_SPEED;
          list.scrollLeft += Math.sign(near) * Math.max(1, speed);
        }
      }
      target(s);
      if (s.x !== s.ghostX) {
        s.ghostX = s.x;
        latest.current.onColumnDrag({ type: "move", x: s.x });
      }
      s.frame = requestAnimationFrame(tick);
    };
    state.current.frame = requestAnimationFrame(tick);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `target` reads only refs
  }, []);

  /** Drops the column where the pointer is, once; a second call finds no drag */
  const drop = useCallback(() => {
    // Where the pointer is now, as a release can come before the next frame reads it
    if (state.current != null) target(state.current);
    // The list lets go of the drag and the order changes in the same task, so nothing jumps.
    const s = stop(true);
    if (s?.to != null) latest.current.onDrop(s.id, s.to);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `target` reads only refs
  }, [stop]);
  const cancel = useCallback(() => {
    stop(false);
  }, [stop]);

  // Columns shown or hidden under a drag, as App is when the first flow with an app arrives,
  // leave its edges and target describing columns that are gone; it is put back instead.
  const shown = shownKey(columns);
  useEffect(() => {
    if (state.current != null && state.current.shown !== shown) cancel();
  }, [shown, cancel]);

  // The pointer from a press on the header until its release, read before dnd-kit sees it.
  // dnd-kit starts a drag on the move that crosses `DRAG_DISTANCE` and reports moves and the
  // release only once it has rendered the drag, so a release right after a move would drop
  // where the pointer was a frame before, or not at all. The release drops it here instead.
  const pointer = useRef(0);
  const track = useCallback((e: PointerEvent) => {
    pointer.current = e.clientX;
    if (state.current != null) state.current.x = e.clientX;
  }, []);
  const unlisten = useRef<(() => void) | null>(null);
  const onPointerDownCapture = useCallback(
    (e: ReactPointerEvent) => {
      unlisten.current?.();
      pointer.current = e.clientX;
      const up = (e: PointerEvent) => {
        unlisten.current?.();
        track(e);
        drop();
      };
      const lost = () => {
        unlisten.current?.();
        cancel();
      };
      window.addEventListener("pointermove", track, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", lost, true);
      unlisten.current = () => {
        unlisten.current = null;
        window.removeEventListener("pointermove", track, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", lost, true);
      };
    },
    [track, drop, cancel],
  );

  // A drag never outlives the header
  useEffect(
    () => () => {
      unlisten.current?.();
      cancel();
    },
    [cancel],
  );

  /** Sets where the drag would drop, telling the list when that changes */
  function target(s: NonNullable<typeof state.current>) {
    const gridLeft = gridRef.current?.getBoundingClientRect().left ?? 0;
    const cells = s.cells.map((c) => ({ left: gridLeft + c.left, right: gridLeft + c.right }));
    const to = dropBoundary(s.x, cells, s.from);
    if (to === s.to) return;
    s.to = to;
    latest.current.onColumnDrag({ type: "target", to });
  }

  return {
    sensors,
    gridRef,
    onPointerDownCapture,
    dndHandlers: { onDragStart, onDragEnd: drop, onDragCancel: cancel },
  };
}

/** Which columns show, in order, to tell when that changes */
function shownKey(columns: Column[]): string {
  return columns.map((c) => c.id).join(" ");
}
