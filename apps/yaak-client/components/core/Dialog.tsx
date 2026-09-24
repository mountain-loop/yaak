import type { DialogSize } from "@yaakapp-internal/plugins";
import { Heading, HStack, Overlay } from "@yaakapp-internal/ui";
import classNames from "classnames";
import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonProps } from "./Button";
import { IconButton } from "./IconButton";

export interface DialogProps {
  children: ReactNode;
  open: boolean;
  onClose?: () => void;
  /** Block dismissal from the backdrop, Escape key, and built-in close button. */
  disableClose?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  size?: DialogSize;
  /** Hide the built-in close button without changing backdrop or Escape behavior. */
  hideX?: boolean;
  noPadding?: boolean;
  noScroll?: boolean;
  vAlign?: "top" | "center";
}

export function Dialog({
  children,
  className,
  size = "full",
  open,
  onClose,
  disableClose,
  title,
  description,
  hideX,
  noPadding,
  noScroll,
  vAlign = "center",
}: DialogProps) {
  const titleId = useMemo(() => Math.random().toString(36).slice(2), []);
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const descriptionId = useMemo(
    () => (description ? Math.random().toString(36).slice(2) : undefined),
    [description],
  );

  return (
    <Overlay open={open} onClose={disableClose ? undefined : onClose} portalName="dialog">
      <div
        role="dialog"
        className={classNames(
          "py-4 x-theme-dialog absolute inset-0 pointer-events-none",
          "h-full flex flex-col items-center justify-center",
          vAlign === "top" && "justify-start",
          vAlign === "center" && "justify-center",
        )}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={(e) => {
          // NOTE: We handle Escape on the element itself so that it doesn't close multiple
          //   dialogs and can be intercepted by children if needed.
          if (e.key === "Escape") {
            if (!disableClose) onClose?.();
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <m.div
          initial={{ top: 5, scale: 0.97 }}
          animate={{ top: 0, scale: 1 }}
          className={classNames(
            className,
            "grid grid-rows-[auto_auto_minmax(0,1fr)_auto]",
            "grid-cols-1", // must be here for inline code blocks to correctly break words
            "relative bg-surface pointer-events-auto",
            "rounded-lg",
            "border border-border-subtle shadow-lg shadow-[rgba(0,0,0,0.1)]",
            "min-h-40",
            "max-w-[calc(100vw-5rem)] max-h-[calc(100vh-5rem)]",
            size === "sm" && "w-120",
            size === "md" && "w-200",
            size === "lg" && "w-280",
            size === "full" && "w-screen h-screen",
            size === "dynamic" && "min-w-80 max-w-[100vw]",
          )}
        >
          {title ? (
            <Heading className="px-6 mt-4 mb-2" level={1} id={titleId}>
              {title}
            </Heading>
          ) : (
            <span />
          )}

          {description ? (
            <div className="min-h-0 px-6 text-text-subtle mb-3" id={descriptionId}>
              {description}
            </div>
          ) : (
            <span />
          )}

          <div
            className={classNames(
              "h-full w-full grid grid-cols-[minmax(0,1fr)] grid-rows-1",
              !noPadding && "px-6 py-2",
              !noScroll && "overflow-y-auto overflow-x-hidden",
            )}
          >
            <DialogFooterSlot.Provider value={footerEl}>{children}</DialogFooterSlot.Provider>
          </div>

          <div ref={setFooterEl} className="contents" />

          {/*Put close at the end so that it's the last thing to be tabbed to*/}
          {!disableClose && !hideX && (
            <div className="ml-auto absolute right-1 top-1">
              <IconButton
                className="opacity-70 hover:opacity-100"
                onClick={onClose}
                title="Close dialog (Esc)"
                aria-label="Close"
                size="sm"
                icon="x"
              />
            </div>
          )}
        </m.div>
      </div>
    </Overlay>
  );
}

const DialogFooterSlot = createContext<HTMLDivElement | null>(null);

export interface DialogFooterAction {
  label: string;
  onClick?: () => void;
  /** Submit the form with this id, which can be anywhere in the dialog body */
  form?: string;
  color?: ButtonProps["color"];
  variant?: ButtonProps["variant"];
  disabled?: boolean;
  isLoading?: boolean;
  autoFocus?: boolean;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
}

/**
 * The action row at the bottom of a dialog. Render it anywhere in the dialog's content and it is
 * placed below the scrolling body, outside its padding. `inline` drops the divider for small
 * dialogs whose body never scrolls.
 */
export function DialogFooter({
  actions,
  leftSlot,
  inline,
}: {
  actions: DialogFooterAction[];
  leftSlot?: ReactNode;
  inline?: boolean;
}) {
  const slot = useContext(DialogFooterSlot);
  if (slot == null) return null;
  return createPortal(
    <footer
      className={classNames(
        "px-6 flex items-center gap-3",
        inline ? "pt-1 pb-4" : "py-3 border-t border-border-subtle",
      )}
    >
      {leftSlot != null && <div className="mr-auto min-w-0">{leftSlot}</div>}
      <HStack space={2} justifyContent="end" className="ml-auto shrink-0">
        {actions.map((action) => (
          <Button
            key={action.label}
            type={action.form != null ? "submit" : "button"}
            form={action.form}
            color={action.color ?? "secondary"}
            variant={action.variant ?? (action.color === "primary" ? "solid" : "border")}
            disabled={action.disabled}
            isLoading={action.isLoading}
            autoFocus={action.autoFocus}
            leftSlot={action.leftSlot}
            rightSlot={action.rightSlot}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </HStack>
    </footer>,
    slot,
  );
}
