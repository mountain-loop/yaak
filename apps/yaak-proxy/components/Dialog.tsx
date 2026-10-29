import { Heading, IconButton, Overlay } from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  /** The row of buttons at the bottom */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** The client's dialog: a titled panel over a backdrop, closed by Escape, its X or the backdrop */
export function Dialog({ open, onClose, title, description, footer, className, children }: Props) {
  return (
    <Overlay open={open} onClose={onClose} portalName="dialog">
      <div
        role="dialog"
        aria-modal
        className="x-theme-dialog absolute inset-0 pointer-events-none grid place-items-center p-10"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        }}
      >
        <div
          className={classNames(
            className,
            "relative pointer-events-auto bg-surface rounded-lg border border-border-subtle",
            "shadow-lg shadow-[rgba(0,0,0,0.1)] max-h-[calc(100vh-5rem)] overflow-y-auto",
          )}
        >
          {title != null && (
            <Heading level={1} className="px-6 mt-5 mb-1 text-lg">
              {title}
            </Heading>
          )}
          {description != null && (
            <div className="px-6 text-text-subtle text-sm">{description}</div>
          )}
          <div className="px-6 py-4">{children}</div>
          {footer != null && (
            <div className="flex items-center gap-2 px-6 pb-5 justify-end">{footer}</div>
          )}
          <div className="absolute right-1 top-1">
            <IconButton
              className="opacity-70 hover:opacity-100"
              onClick={onClose}
              title="Close dialog (Esc)"
              size="sm"
              icon="x"
            />
          </div>
        </div>
      </div>
    </Overlay>
  );
}
