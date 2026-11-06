import classNames from "classnames";
import { memo, useCallback, useMemo } from "react";
import { Button } from "../Button";
import type { DropdownItem } from "../Dropdown";
import { useEditorHost } from "../EditorHost";
import { Icon } from "../Icon";
import type { RadioDropdownItem } from "../RadioDropdown";
import { RadioDropdown } from "../RadioDropdown";
import { HttpMethodTagRaw } from "../tags/HttpMethodTag";

type Props = {
  method: string;
  /** Colour the method by what it does, as the client's setting chooses */
  colored?: boolean;
  onChange?: (method: string) => void | Promise<void>;
  /** Show the method without a menu to change it */
  readOnly?: boolean;
  className?: string;
};

const METHODS = ["GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS", "QUERY", "HEAD"];

export const RequestMethodDropdown = memo(function RequestMethodDropdown({
  method,
  colored,
  onChange,
  readOnly,
  className,
}: Props) {
  const { showPrompt } = useEditorHost();

  const radioItems = useMemo<RadioDropdownItem<string>[]>(
    () =>
      METHODS.map((m) => ({ value: m, label: <HttpMethodTagRaw method={m} colored={colored} /> })),
    [colored],
  );

  const handleChange = useCallback(
    async (method: string) => {
      await onChange?.(method);
    },
    [onChange],
  );

  const itemsAfter = useMemo<DropdownItem[]>(
    () => [
      {
        key: "custom",
        label: "CUSTOM",
        leftSlot: <Icon icon="sparkles" />,
        hidden: showPrompt == null,
        onSelect: async () => {
          const newMethod = await showPrompt?.({
            id: "custom-method",
            label: "Http Method",
            title: "Custom Method",
            confirmText: "Save",
            description: "Enter a custom method name",
            placeholder: "CUSTOM",
          });
          if (newMethod == null) return;
          await handleChange(newMethod);
        },
      },
    ],
    [handleChange, showPrompt],
  );

  const button = (
    <Button size="xs" className={classNames(className, "text-text-subtle hover:text")}>
      <HttpMethodTagRaw method={method} colored={colored} />
    </Button>
  );

  if (readOnly) return button;

  return (
    <RadioDropdown
      value={method}
      items={radioItems}
      itemsAfter={itemsAfter}
      onChange={handleChange}
    >
      {button}
    </RadioDropdown>
  );
});
