import type { Color } from "@yaakapp-internal/plugins";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { CopyIconButton } from "../CopyIconButton";
import { DialogFooter } from "./Dialog";
import { PlainInput } from "./PlainInput";

export interface ConfirmProps {
  onHide: () => void;
  onResult: (result: boolean) => void;
  confirmText?: string;
  requireTyping?: string;
  color?: Color;
}

export function Confirm({
  onHide,
  onResult,
  confirmText,
  requireTyping,
  color = "primary",
}: ConfirmProps) {
  const [confirm, setConfirm] = useState<string>("");
  const formId = useId();
  const handleHide = () => {
    onResult(false);
    onHide();
  };

  const didConfirm = !requireTyping || confirm === requireTyping;

  const handleSuccess = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (didConfirm) {
      onResult(true);
      onHide();
    }
  };

  return (
    <form id={formId} className="flex flex-col" onSubmit={handleSuccess}>
      {requireTyping && (
        <PlainInput
          autoFocus
          onChange={setConfirm}
          placeholder={requireTyping}
          labelRightSlot={
            <CopyIconButton
              tabIndex={-1}
              text={requireTyping}
              title="Copy name"
              className="text-text-subtlest"
              iconSize="sm"
              size="2xs"
            />
          }
          label={
            <>
              Type <strong>{requireTyping}</strong> to confirm
            </>
          }
        />
      )}
      <DialogFooter
        inline
        actions={[
          { label: "Cancel", onClick: handleHide },
          {
            label: confirmText ?? "Confirm",
            color,
            form: formId,
            disabled: !didConfirm,
            autoFocus: !requireTyping,
          },
        ]}
      />
    </form>
  );
}
