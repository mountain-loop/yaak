import type { Color } from "@yaakapp-internal/plugins";
import type { HTMLAttributes, ReactNode } from "react";

type ButtonVariant = "border" | "solid";
type ButtonSize = "2xs" | "xs" | "sm" | "md" | "auto";

export type ButtonProps = Omit<
  HTMLAttributes<HTMLButtonElement>,
  "color" | "onChange"
> & {
  innerClassName?: string;
  color?: Color | "custom" | "default";
  tone?: Color | "default";
  variant?: ButtonVariant;
  isLoading?: boolean;
  size?: ButtonSize;
  justify?: "start" | "center";
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  isLoading,
  className,
  innerClassName,
  children,
  color,
  tone,
  type = "button",
  justify = "center",
  size = "md",
  variant = "solid",
  leftSlot,
  rightSlot,
  disabled,
  title,
  onClick,
  ...props
}: ButtonProps) {
  const resolvedColor = color ?? tone ?? "default";
  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      className={cx(
        className,
        "x-theme-button",
        `x-theme-button--${variant}`,
        `x-theme-button--${variant}--${resolvedColor}`,
        "border",
        "max-w-full min-w-0",
        "hocus:opacity-100",
        "whitespace-nowrap outline-none",
        "flex-shrink-0 flex items-center",
        "outline-0",
        isDisabled ? "pointer-events-none opacity-disabled" : "pointer-events-auto",
        justify === "start" && "justify-start",
        justify === "center" && "justify-center",
        size === "md" && "h-md px-3 rounded-md",
        size === "sm" && "h-sm px-2.5 rounded-md",
        size === "xs" && "h-xs px-2 text-sm rounded-md",
        size === "2xs" && "h-2xs px-2 text-xs rounded",
        size === "auto" && "px-3 py-2 rounded-md",
        variant === "solid" && "border-transparent",
        variant === "solid" &&
          resolvedColor === "custom" &&
          "focus-visible:outline-2 outline-border-focus",
        variant === "solid" &&
          resolvedColor !== "custom" &&
          "text-text enabled:hocus:text-text enabled:hocus:bg-surface-highlight outline-border-subtle",
        variant === "solid" &&
          resolvedColor !== "custom" &&
          resolvedColor !== "default" &&
          "bg-surface",
        variant === "border" && "border",
        variant === "border" &&
          resolvedColor !== "custom" &&
          "border-border-subtle text-text-subtle enabled:hocus:border-border enabled:hocus:bg-surface-highlight enabled:hocus:text-text outline-border-subtler",
      )}
      disabled={isDisabled}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
      }}
      title={title}
      {...props}
    >
      {isLoading ? (
        <div className="mr-1">...</div>
      ) : leftSlot ? (
        <div className="mr-2">{leftSlot}</div>
      ) : null}
      <div
        className={cx(
          "truncate w-full",
          justify === "start" ? "text-left" : "text-center",
          innerClassName,
        )}
      >
        {children}
      </div>
      {rightSlot ? <div className="ml-1">{rightSlot}</div> : null}
    </button>
  );
}
