import { platform } from "@yaakapp-internal/platform";
import { HStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import mime from "mime";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { ButtonProps } from "./core/Button";
import { Button } from "./core/Button";
import { IconButton } from "./core/IconButton";
import { IconTooltip } from "./core/IconTooltip";
import { Label } from "./core/Label";

type Props = Omit<ButtonProps, "type"> & {
  onChange: (value: { filePath: string | null; contentType: string | null }) => void;
  filePath: string | null;
  nameOverride?: string | null;
  directory?: boolean;
  inline?: boolean;
  noun?: string;
  help?: ReactNode;
  hideLabel?: boolean;
  label?: ReactNode;
};

// Special character to insert ltr text in rtl element
const rtlEscapeChar = <>&#x200E;</>;

export function SelectFile({
  onChange,
  filePath,
  inline,
  className,
  directory,
  noun,
  nameOverride,
  size = "sm",
  label,
  help,
  hideLabel,
  ...props
}: Props) {
  const handleClick = async () => {
    const filePath = await platform.dialog.open({
      title: directory ? "Select Folder" : "Select File",
      multiple: false,
      directory,
    });
    if (filePath == null) return;
    const contentType = filePath ? mime.getType(filePath) : null;
    onChange({ filePath, contentType });
  };

  const handleClear = async () => {
    onChange({ filePath: null, contentType: null });
  };

  const itemLabel = noun ?? (directory ? "Folder" : "File");
  const selectOrChange = (filePath ? "Change " : "Select ") + itemLabel;
  const [isHovering, setIsHovering] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Listen for dropped files on the element
  // NOTE: This doesn't work for Windows since native drag-n-drop can't work at the same tmie
  //  as browser drag-n-drop.
  useEffect(() => {
    return platform.window.onDragDrop((event) => {
      if (event.type === "over") {
        const p = event.position;
        const r = ref.current?.getBoundingClientRect();
        if (r == null) return;
        const isOver = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
        setIsHovering(isOver);
      } else if (event.type === "drop" && isHovering) {
        const p = event.paths[0];
        if (p) onChange({ filePath: p, contentType: null });
        setIsHovering(false);
      } else {
        setIsHovering(false);
      }
    });
  }, [isHovering, onChange]);

  const filePathWithNameOverride = nameOverride ? `${filePath} (${nameOverride})` : filePath;

  return (
    <div ref={ref} className="w-full">
      {label && (
        <Label htmlFor={null} help={help} visuallyHidden={hideLabel}>
          {label}
        </Label>
      )}
      <HStack className="relative justify-stretch overflow-hidden">
        <Button
          className={classNames(
            className,
            "rtl mr-1.5",
            inline && "w-full",
            filePath && inline && "font-mono text-xs",
            isHovering && "border-notice!",
          )}
          color={isHovering ? "primary" : "secondary"}
          onClick={handleClick}
          size={size}
          {...props}
        >
          {rtlEscapeChar}
          {inline ? filePathWithNameOverride || selectOrChange : selectOrChange}
        </Button>

        {!inline && (
          <>
            {filePath && (
              <IconButton
                size={size === "auto" ? "md" : size}
                variant="border"
                icon="x"
                title={`Unset ${itemLabel}`}
                onClick={handleClear}
              />
            )}
            <div
              className={classNames(
                "truncate rtl pl-1.5 pr-3 text-text",
                filePath && "font-mono",
                size === "xs" && filePath && "text-xs",
                size === "sm" && filePath && "text-sm",
              )}
            >
              {rtlEscapeChar}
              {filePath ?? `No ${itemLabel.toLowerCase()} selected`}
            </div>
            {filePath == null && help && !label && <IconTooltip content={help} />}
          </>
        )}
      </HStack>
    </div>
  );
}
