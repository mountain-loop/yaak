import type { Color } from "@yaakapp-internal/plugins";
import type { FormEvent } from "react";
import { useState } from "react";
import { CopyIconButton } from "../CopyIconButton";
import { Button } from "./Button";
import { PlainInput } from "./PlainInput";
import { HStack } from "./Stacks";

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
    <form className="flex flex-col" onSubmit={handleSuccess}>
      {requireTyping && (
        <PlainInput
          autoFocus
          onChange={setConfirm}
          placeholder={requireTyping}
          labelRightSlot={
            <CopyIconButton
              tabIndex={-1}
              text={requireTyping}
              title="Скопировать имя"
              className="text-text-subtlest"
              iconSize="sm"
              size="2xs"
            />
          }
          label={
            <>
              Введите <strong>{requireTyping}</strong>, чтобы подтвердить
            </>
          }
        />
      )}
      <HStack space={2} justifyContent="start" className="mt-2 mb-4 flex-row-reverse">
        <Button type="submit" color={color} disabled={!didConfirm}>
          {confirmText ?? "Подтвердить"}
        </Button>
        <Button onClick={handleHide} variant="border">
          Отмена
        </Button>
      </HStack>
    </form>
  );
}
