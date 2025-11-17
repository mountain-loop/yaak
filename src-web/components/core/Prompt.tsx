import type { FormInput, JsonPrimitive } from '@yaakapp-internal/plugins';
import type { FormEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { generateId } from '../../lib/generateId';
import { DynamicForm } from '../DynamicForm';
import { Button } from './Button';
import { HStack } from './Stacks';

export interface PromptProps {
  inputs: FormInput[];
  onCancel: () => void;
  onResult: (value: Record<string, JsonPrimitive> | null) => void;
  confirmText?: string;
  cancelText?: string;
}

export function Prompt({
  onCancel,
  inputs,
  onResult,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
}: PromptProps) {
  const [value, setValue] = useState<Record<string, JsonPrimitive>>({});
  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      onResult(value);
    },
    [onResult, value],
  );

  const id = 'prompt.form.' + useRef(generateId()).current;

  return (
    <form
      className="grid grid-rows-[auto_auto] grid-cols-[minmax(0,1fr)] gap-4 mb-4"
      onSubmit={handleSubmit}
    >
      <DynamicForm inputs={inputs} onChange={setValue} data={value} stateKey={id} />
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
