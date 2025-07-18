import type { Color } from '@yaakapp-internal/plugins';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Button } from './Button';
import { PlainInput } from './PlainInput';
import { HStack } from './Stacks';

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
  color = 'primary',
}: ConfirmProps) {
  const [confirm, setConfirm] = useState<string>('');
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
          label={
            <>
              Type <strong>{requireTyping}</strong> to confirm
            </>
          }
        />
      )}
      <HStack space={2} justifyContent="start" className="mt-2 mb-4 flex-row-reverse">
        <Button type="submit" color={color} disabled={!didConfirm}>
          {confirmText ?? 'Confirm'}
        </Button>
        <Button onClick={handleHide} variant="border">
          Cancel
        </Button>
      </HStack>
    </form>
  );
}
