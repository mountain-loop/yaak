import type { FlowSortKey, SortColumn } from "@yaakapp-internal/proxy-lib";
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
import { memo, type MouseEvent, useCallback, useRef, useState } from "react";
import {
  addSortKey,
  allColumns,
  type Column,
  type ColumnDef,
  type ColumnId,
  type ColumnPrefs,
  canHide,
  hideOtherColumns,
  isCustomColumn,
  removeCustomColumn,
  resetWidth,
  resetWidths,
  resizeColumn,
  toggleColumn,
  unavailableColumns,
} from "../lib/columns";
import { columnPrefsAtom, hasAppsAtom } from "../lib/store";
import { addColumnDialogAtom } from "./AddColumnDialog";

interface Props {
  columns: Column[];
  template: string;
  /** The rows' width, as CSS, so the header scrolls sideways with them */
  width: string;
  prefs: ColumnPrefs;
  sort: FlowSortKey[];
  /** A click on a label, or with `add`, an Option-click */
  onSort: (column: SortColumn, add: boolean) => void;
  /** Sets the sort from the menus; empty goes back to arrival order */
  onSetSort: (sort: FlowSortKey[]) => void;
  onResetSort: () => void;
}

/**
 * The list's only control surface: a click on a label sorts by it alone, a second reverses it
 * and a third goes back to arrival order; Option-click adds it to the sort as a further key.
 * Dragging the edge after a label resizes its column and a double-click on it resets it. A
 * right-click on a label opens the column's menu; the picker sits in the empty corner on hover.
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
}: Props) {
  const setPrefs = useSetAtom(columnPrefsAtom);
  const unavailable = unavailableColumns(useAtomValue(hasAppsAtom));
  const openAddColumn = useSetAtom(addColumnDialogAtom);
  const [menu, setMenu] = useState<{ x: number; y: number; column: ColumnDef | null } | null>(null);
  // Widths when a drag began, so each move sets the width from where it started.
  const startWidth = useRef(0);

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
                  onSelect: () => setPrefs((p) => removeCustomColumn(p, c.id as `field:${string}`)),
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
  ];

  const columnItems = (c: ColumnDef): DropdownItem[] => {
    const column = c.sortable ? (c.id as SortColumn) : null;
    const sortBy = (descending: boolean) => {
      if (column != null) setSort([{ column, descending }]);
    };
    const addTo = (descending: boolean) => {
      if (column != null) setSort(addSortKey(sort, column, descending));
    };
    return [
      ...(column == null
        ? []
        : ([
            { label: "Sort Ascending", onSelect: () => sortBy(false) },
            { label: "Sort Descending", onSelect: () => sortBy(true) },
            { label: "Add to Sort Ascending", onSelect: () => addTo(false) },
            { label: "Add to Sort Descending", onSelect: () => addTo(true) },
          ] satisfies DropdownItem[])),
      { label: "Clear Sorting", disabled: sort.length === 0, onSelect: onResetSort },
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
              onSelect: () => setPrefs((p) => removeCustomColumn(p, c.id as `field:${string}`)),
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
        {columns.map((c) => {
          const at = sort.findIndex((k) => k.column === c.id);
          const key = sort[at];
          const label = (
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
          const labelClass = classNames(
            "flex items-center gap-0.5 min-w-0 w-full h-full whitespace-nowrap",
            c.align === "right" && "justify-end",
            key != null && "text-text-subtle",
          );
          return (
            <span
              key={c.id}
              data-column={c.id}
              className="relative h-full flex items-center min-w-0 px-1.5"
            >
              {c.sortable ? (
                <button
                  type="button"
                  onClick={(e) => onSort(c.id as SortColumn, e.altKey)}
                  // No tooltip: the header sits under the search field, and a tooltip here covered it
                  aria-label={`Sort by ${c.label}`}
                  className={classNames(labelClass, "hover:text-text-subtle")}
                >
                  {label}
                </button>
              ) : (
                <span className={labelClass}>{label}</span>
              )}
              {/* On the column's right edge, the boundary with the next, resizing this one */}
              <ResizeHandle
                side="right"
                justify="center"
                className="absolute top-0 translate-x-1/2"
                onResizeStart={() => {
                  startWidth.current = c.current;
                }}
                onResizeMove={(e) =>
                  setPrefs((p) => resizeColumn(p, c.id, startWidth.current + e.x - e.xStart))
                }
                onReset={() => setPrefs((p) => resetWidth(p, c.id))}
              />
            </span>
          );
        })}
        <ContextMenu
          triggerPosition={menu}
          items={menu == null ? [] : menu.column == null ? pickerItems : columnItems(menu.column)}
          onClose={() => setMenu(null)}
        />
      </div>
    </div>
  );
});
