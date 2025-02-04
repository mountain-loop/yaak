import type { PromptTextRequest } from '@yaakapp-internal/plugins';
import type { FormEvent, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Button } from './Button';
import { PlainInput } from './PlainInput';
import { HStack } from './Stacks';

export type PromptProps = Omit<PromptTextRequest, 'id' | 'title' | 'description'> & {
  description?: ReactNode;
  onCancel: () => void;
  onResult: (value: string | null) => void;
};

export function Prompt({
  onCancel,
  label,
  defaultValue,
  placeholder,
  onResult,
  required,
  confirmText,
  cancelText,
}: PromptProps) {
  const [value, setValue] = useState<string>(defaultValue ?? '');
  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      onResult(value);
    },
    [onResult, value],
  );

  return (
    <form
      className="grid grid-rows-[auto_auto] grid-cols-[minmax(0,1fr)] gap-4 mb-4"
      onSubmit={handleSubmit}
    >
      <PlainInput
        hideLabel
        autoSelect
        required={required}
        placeholder={placeholder ?? 'Enter text'}
        label={label}
        defaultValue={defaultValue}
        onChange={setValue}
      />
      <HStack space={2} justifyContent="end">
        <Button onClick={onCancel} variant="border" color="secondary">
          {cancelText || 'Cancel'}
        </Button>
        <Button type="submit" color="primary">
          {confirmText || 'Done'}
        </Button>
      </HStack>
    </form>
  );
}
