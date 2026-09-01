import { Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { ReactNode } from "react";
import { useState } from "react";
import type { CheckboxProps } from "./Checkbox";
import { Checkbox } from "./Checkbox";

export interface CheckboxTreeNode<T> {
  key: string;
  data: T;
  children: CheckboxTreeNode<T>[];
}

interface Props<T> {
  node: CheckboxTreeNode<T>;
  depth?: number;
  /** Return "hidden" to render row alignment space instead of a checkbox */
  checked: (node: CheckboxTreeNode<T>) => CheckboxProps["checked"] | "hidden";
  onCheck: (node: CheckboxTreeNode<T>, checked: boolean) => void;
  checkboxTitle?: (node: CheckboxTreeNode<T>) => string;
  isCheckboxDisabled?: (node: CheckboxTreeNode<T>) => boolean;
  /** An irrelevant row is hidden unless one of its descendants is relevant */
  isRelevant: (node: CheckboxTreeNode<T>) => boolean;
  renderRow: (node: CheckboxTreeNode<T>) => ReactNode;
  onSelectRow?: (node: CheckboxTreeNode<T>) => void;
  canSelectRow?: (node: CheckboxTreeNode<T>) => boolean;
  isRowSelected?: (node: CheckboxTreeNode<T>) => boolean;
}

export function CheckboxTree<T>(props: Props<T>) {
  const { node, depth = 0 } = props;
  const [collapsed, setCollapsed] = useState<boolean>(false);
  if (!hasRelevantNode(node, props.isRelevant)) return null;

  const checked = props.checked(node);
  const selected = props.isRowSelected?.(node) ?? false;
  const selectable = props.onSelectRow != null && (props.canSelectRow?.(node) ?? true);
  const hasVisibleChildren = node.children.some((c) => hasRelevantNode(c, props.isRelevant));
  const rowContent = (
    <div className="flex-1 min-w-0 flex items-center gap-1 px-1 py-0.5 text-left">
      {props.renderRow(node)}
    </div>
  );

  return (
    <div
      className={classNames(
        depth > 0 && "pl-4 ml-2 border-l border-dashed border-border-subtle relative",
      )}
    >
      <div
        className={classNames(
          "relative flex gap-1 w-full h-xs items-center",
          selected ? "text-text" : "text-text-subtle",
        )}
      >
        {selected && (
          <div className="absolute left-[-100vw] right-0 top-0 bottom-0 bg-surface-active opacity-30 -z-10" />
        )}
        {hasVisibleChildren ? (
          <button
            type="button"
            aria-label={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            className="shrink-0 text-text-subtlest hocus:text-text"
            onClick={() => setCollapsed((v) => !v)}
          >
            <Icon size="sm" icon={collapsed ? "chevron_right" : "chevron_down"} />
          </button>
        ) : (
          <span aria-hidden className="w-4 shrink-0" />
        )}
        {checked === "hidden" ? (
          <span aria-hidden className="w-4 mr-0.5 shrink-0" />
        ) : (
          <Checkbox
            checked={checked}
            title={props.checkboxTitle?.(node) ?? "Toggle"}
            hideLabel
            disabled={props.isCheckboxDisabled?.(node)}
            onChange={(checked) => props.onCheck(node, checked)}
          />
        )}
        {selectable ? (
          <button
            type="button"
            className="flex-1 min-w-0 flex text-left"
            onClick={() => props.onSelectRow?.(node)}
          >
            {rowContent}
          </button>
        ) : (
          rowContent
        )}
      </div>

      {!collapsed &&
        node.children.map((child) => (
          <CheckboxTree key={child.key} {...props} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function hasRelevantNode<T>(
  node: CheckboxTreeNode<T>,
  isRelevant: (node: CheckboxTreeNode<T>) => boolean,
): boolean {
  return isRelevant(node) || node.children.some((c) => hasRelevantNode(c, isRelevant));
}
