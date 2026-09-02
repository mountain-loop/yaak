import type { IconProps } from "@yaakapp-internal/ui";
import { HStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { type ReactNode, useRef } from "react";
import { useStateWithDeps } from "../../hooks/useStateWithDeps";
import { generateId } from "../../lib/generateId";
import { Button } from "./Button";
import { IconButton, type IconButtonProps } from "./IconButton";
import { IconTooltip } from "./IconTooltip";
import { Label } from "./Label";

interface Props<T extends string> {
  options: { value: T; label: string; icon?: IconProps["icon"] }[];
  onChange: (value: T) => void;
  value: T;
  name: string;
  size?: IconButtonProps["size"];
  label: string;
  className?: string;
  hideLabel?: boolean;
  labelClassName?: string;
  help?: ReactNode;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "xs",
  label,
  hideLabel,
  labelClassName,
  help,
  className,
}: Props<T>) {
  const [selectedValue, setSelectedValue] = useStateWithDeps<T>(value, [value]);
  const containerRef = useRef<HTMLDivElement>(null);
  const id = useRef(`input-${generateId()}`);

  // A visually hidden label has nowhere to show the help, so the last option carries it
  const inlineHelp =
    hideLabel && help ? <IconTooltip tabIndex={-1} content={help} iconSize="xs" /> : null;

  return (
    <div className="w-full grid">
      <Label
        htmlFor={id.current}
        help={hideLabel ? undefined : help}
        visuallyHidden={hideLabel}
        className={classNames(labelClassName)}
      >
        {label}
      </Label>
      <HStack
        id={id.current}
        ref={containerRef}
        role="group"
        dir="ltr"
        space={1}
        className={classNames(
          className,
          "bg-surface-highlight rounded-lg mb-auto mr-auto",
          "transition-opacity transform-gpu p-1",
        )}
        onKeyDown={(e) => {
          const selectedIndex = options.findIndex((o) => o.value === selectedValue);
          if (e.key === "ArrowRight") {
            e.preventDefault();
            const newIndex = Math.abs((selectedIndex + 1) % options.length);
            if (options[newIndex]) {
              setSelectedValue(options[newIndex].value);
            }
            const child = containerRef.current?.children[newIndex] as HTMLButtonElement;
            child.focus();
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            const newIndex = Math.abs((selectedIndex - 1) % options.length);
            if (options[newIndex]) {
              setSelectedValue(options[newIndex].value);
            }
            const child = containerRef.current?.children[newIndex] as HTMLButtonElement;
            child.focus();
          }
        }}
      >
        {options.map((o, i) => {
          const isSelected = selectedValue === o.value;
          const isActive = value === o.value;
          const rightSlot = i === options.length - 1 ? inlineHelp : null;
          if (o.icon == null) {
            return (
              <Button
                key={o.label}
                aria-checked={isActive}
                size={size}
                variant="solid"
                color={isActive ? "secondary" : undefined}
                role="radio"
                tabIndex={isSelected ? 0 : -1}
                className={classNames(
                  isActive && "text-text!",
                  "focus:ring-1 focus:ring-border-focus",
                )}
                rightSlot={rightSlot}
                onClick={() => onChange(o.value)}
              >
                {o.label}
              </Button>
            );
          } else {
            return (
              <IconButton
                key={o.label}
                aria-checked={isActive}
                size={size}
                variant="solid"
                color={isActive ? "secondary" : undefined}
                role="radio"
                tabIndex={isSelected ? 0 : -1}
                className={classNames(
                  isActive && "text-text!",
                  "px-1.5! w-auto!",
                  "focus:ring-border-focus",
                )}
                title={o.label}
                icon={o.icon}
                rightSlot={rightSlot}
                onClick={() => onChange(o.value)}
              />
            );
          }
        })}
      </HStack>
    </div>
  );
}
