import { Icon, type IconProps } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { forwardRef, type ReactNode } from "react";
import { Dropdown, type DropdownItem } from "./Dropdown";
import { IconButton } from "./IconButton";

export interface PathListItem {
  path: string;
  icon: IconProps["icon"];
  /** Replaces the parent-path line under the name */
  subtitle?: ReactNode;
  failed?: boolean;
}

interface Props {
  items: PathListItem[];
  disabled?: boolean;
  onRemove: (path: string) => void;
  addItems: DropdownItem[];
  addLabel: string;
  addHint?: string;
  hovering?: boolean;
  /** Rows rendered between the items and the add row, such as an inline input */
  children?: ReactNode;
}

/** Selected files, folders, or URLs as cards, with a dashed add row that opens a menu. */
export const PathList = forwardRef<HTMLDivElement, Props>(function PathList(
  { items, disabled, onRemove, addItems, addLabel, addHint, hovering, children },
  ref,
) {
  return (
    <div
      ref={ref}
      className={classNames(
        "flex flex-col gap-1.5 rounded-lg -m-1.5 p-1.5",
        hovering && "bg-surface-highlight",
      )}
    >
      {items.map((item) => {
        const { name, parent } = splitPath(item.path);
        return (
          <div
            key={item.path}
            className={classNames(
              "flex items-center gap-3 rounded-md pl-3 pr-1.5 py-2",
              item.failed ? "bg-danger/10" : "bg-surface-highlight/50",
            )}
          >
            <Icon
              icon={item.icon}
              className={classNames("shrink-0", item.failed ? "text-danger" : "text-text-subtle")}
            />
            <div className="min-w-0 flex-1" title={item.path}>
              <div className="truncate text-sm font-semibold">{name}</div>
              <div
                className={classNames(
                  "flex items-center gap-1.5 truncate text-xs",
                  item.failed ? "text-danger" : "text-text-subtlest",
                )}
              >
                {item.subtitle ??
                  (parent !== "" && <span className="truncate font-mono">{parent}</span>)}
              </div>
            </div>
            <IconButton
              size="xs"
              icon="trash"
              iconColor="secondary"
              title={`Remove ${name}`}
              disabled={disabled}
              className="shrink-0"
              onClick={() => onRemove(item.path)}
            />
          </div>
        );
      })}
      {children}
      <Dropdown items={addItems}>
        <button
          type="button"
          disabled={disabled}
          className={classNames(
            "h-sm w-full flex items-center gap-2 rounded-md border border-dashed px-3 text-sm text-text-subtle",
            "hocus:border-border-focus hocus:text-text disabled:opacity-disabled",
            hovering ? "border-notice" : "border-border",
          )}
        >
          <Icon icon="plus" size="sm" className="text-text-subtlest" />
          {hovering ? (
            "Drop to add"
          ) : (
            <>
              <span>{addLabel}</span>
              {addHint != null && (
                <span className="ml-auto text-xs text-text-subtlest">{addHint}</span>
              )}
            </>
          )}
        </button>
      </Dropdown>
    </div>
  );
});

/** The last segment as the name and everything before it, shortened, as the parent. */
export function splitPath(path: string): { name: string; parent: string } {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      const segments = url.pathname.split("/").filter(Boolean);
      const name = segments.at(-1) ?? url.host;
      const parent = segments.length > 0 ? `${url.host}/${segments.slice(0, -1).join("/")}` : "";
      return { name, parent: parent.replace(/\/$/, "") };
    } catch {
      return { name: path, parent: "" };
    }
  }
  const parts = path.split(/[/\\]/).filter(Boolean);
  const name = parts.at(-1) ?? path;
  const dirs = parts.slice(0, -1);
  const parent = dirs.length > 3 ? `…/${dirs.slice(-3).join("/")}` : dirs.join("/");
  return { name, parent };
}
