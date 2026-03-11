import type { Color } from "@yaakapp-internal/plugins";
import classNames from "classnames";
import type { HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { Icon } from "./Icon";
import { LoadingIcon } from "./LoadingIcon";

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
  forDropdown?: boolean;
  disabled?: boolean;
  title?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    isLoading,
    className,
    innerClassName,
    children,
    color,
    tone,
    forDropdown,
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
  }: ButtonProps,
  ref,
) {
  const resolvedColor = color ?? tone ?? "default";
  const isDisabled = disabled || isLoading;

  return (
    <button
      ref={ref}
      type={type}
      className={classNames(
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
          "border-border-subtle text-text-subtle enabled:hocus:border-border " +
            "enabled:hocus:bg-surface-highlight enabled:hocus:text-text outline-border-subtler",
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
        <LoadingIcon size={size === "auto" ? "md" : size} className="mr-1" />
      ) : leftSlot ? (
        <div className="mr-2">{leftSlot}</div>
      ) : null}
      <div
        className={classNames(
          "truncate w-full",
          justify === "start" ? "text-left" : "text-center",
          innerClassName,
        )}
      >
        {children}
      </div>
      {rightSlot && <div className="ml-1">{rightSlot}</div>}
      {forDropdown && (
        <Icon
          icon="chevron_down"
          size={size === "auto" ? "md" : size}
          className="ml-1 -mr-1 relative top-[0.1em]"
        />
      )}
    </button>
  );
});
