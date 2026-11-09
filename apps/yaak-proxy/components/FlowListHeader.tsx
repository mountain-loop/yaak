import {
  ContextMenu,
  Dropdown,
  type DropdownItem,
  Icon,
  IconButton,
  ResizeHandle,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useSetAtom } from "jotai";
import { memo, type MouseEvent, useCallback, useRef, useState } from "react";
import {
  type Column,
  COLUMNS,
  type ColumnId,
  type ColumnPrefs,
  type FlowSort,
  resetWidth,
  resetWidths,
  resizeColumn,
  toggleColumn,
} from "../lib/columns";
import { useExportShownHar } from "../lib/flowActions";
import { columnPrefsAtom } from "../lib/store";

interface Props {
  columns: Column[];
  template: string;
  /** The rows' width, as CSS, so the header scrolls sideways with them */
  width: string;
  prefs: ColumnPrefs;
  sort: FlowSort | null;
  onSort: (column: ColumnId) => void;
  onSortByStart: () => void;
}

/**
 * The list's only control surface: a click on a label sorts by it, a second reverses it and a
 * third goes back to start time. Dragging the edge after a label resizes its column and a
 * double-click on it resets it. The picker sits in the empty corner on hover, or anywhere on a
 * right-click.
 */
export const FlowListHeader = memo(function FlowListHeader({
  columns,
  template,
  width,
  prefs,
  sort,
  onSort,
  onSortByStart,
}: Props) {
  const setPrefs = useSetAtom(columnPrefsAtom);
  const exportShown = useExportShownHar();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Widths when a drag began, so each move sets the width from where it started.
  const startWidth = useRef(0);

  const items: DropdownItem[] = [
    {
      type: "content",
      label: <div className="px-1.5 pt-1 text-xs text-text-subtlest">Columns</div>,
    },
    ...COLUMNS.map((c): DropdownItem => ({
      label: c.label,
      keepOpenOnSelect: true,
      disabled: c.id === "path",
      leftSlot:
        (prefs.visible[c.id] ?? c.defaultVisible) || c.id === "path" ? (
          <Icon icon="check" size="sm" />
        ) : (
          <span aria-hidden className="inline-block w-4 h-4" />
        ),
      rightSlot:
        c.id === "path" ? <span className="text-xs text-text-subtlest">always</span> : undefined,
      onSelect: () => setPrefs((p) => toggleColumn(p, c.id)),
    })),
    { type: "separator" },
    { label: "Sort by Start Time", disabled: sort == null, onSelect: onSortByStart },
    { label: "Reset Column Widths", onSelect: () => setPrefs((p) => resetWidths(p)) },
    { type: "separator" },
    exportShown(),
  ];

  const openMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    // The same margins and padding as the rows, so each label sits over its cells.
    <div style={{ width, minWidth: "100%" }} className="px-1.5">
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a right-click opens the same menu as the picker */}
      <div
        onContextMenu={openMenu}
        style={{ gridTemplateColumns: template }}
        className={classNames(
          "group/header grid items-center h-xs px-1.5 select-none",
          "text-xs text-text-subtlest border-b border-border-subtle",
        )}
      >
        <span className="flex items-center justify-center">
          <Dropdown items={items}>
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
        {columns.map((c) => (
          <span key={c.id} className="relative h-full flex items-center min-w-0 px-1.5">
            <button
              type="button"
              onClick={() => onSort(c.id)}
              // No tooltip: the header sits under the search field, and a tooltip here covered it
              aria-label={`Sort by ${c.label}`}
              className={classNames(
                "flex items-center gap-0.5 min-w-0 w-full h-full whitespace-nowrap hover:text-text-subtle",
                c.align === "right" && "justify-end",
                sort?.column === c.id && "text-text-subtle",
              )}
            >
              {sort?.column === c.id && (
                <Icon
                  icon="chevron_down"
                  size="xs"
                  className={classNames("shrink-0", !sort.descending && "rotate-180")}
                />
              )}
              <span className="truncate">{c.id === "app" ? "" : c.label}</span>
            </button>
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
        ))}
        <ContextMenu triggerPosition={menu} items={items} onClose={() => setMenu(null)} />
      </div>
    </div>
  );
});
