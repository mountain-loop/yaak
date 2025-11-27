import type { FormInput, PromptSelectRequest } from '@yaakapp-internal/plugins';
import type { ReactNode } from 'react';
import type { DialogProps } from '../components/core/Dialog';
import { showPromptForm } from './prompt-form';

type PromptProps = Omit<PromptSelectRequest, 'id' | 'title' | 'description'> & {
  description?: ReactNode;
  onCancel: () => void;
  onResult: (value: string | null) => void;
};

type PromptSelectArgs = Pick<DialogProps, 'title' | 'description'> &
  Omit<PromptProps, 'onClose' | 'onCancel' | 'onResult'> & { id: string };

export async function showPromptSelect({
  id,
  title,
  description,
  cancelText,
  confirmText,
  required,
  ...props
}: PromptSelectArgs) {
  const inputs: FormInput[] = [
    {
      ...props,
      optional: !required,
      type: 'select',
      name: 'value'
    },
  ];

  const result = await showPromptForm({
    id,
    title,
    description,
    inputs,
    cancelText,
    confirmText,
  });

  if (result == null) return null; // Cancelled
  if (typeof result.value === 'string') return result.value;
  return props.defaultValue ?? '';
}
