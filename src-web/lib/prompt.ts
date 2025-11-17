import type { FormInput, PromptTextRequest } from '@yaakapp-internal/plugins';
import type { ReactNode } from 'react';
import type { DialogProps } from '../components/core/Dialog';
import { showPromptForm } from './prompt-form';

type PromptProps = Omit<PromptTextRequest, 'id' | 'title' | 'description'> & {
  description?: ReactNode;
  onCancel: () => void;
  onResult: (value: string | null) => void;
};

type PromptArgs = Pick<DialogProps, 'title' | 'description'> &
  Omit<PromptProps, 'onClose' | 'onCancel' | 'onResult'> & { id: string };

export async function showPrompt({
  id,
  title,
  description,
  cancelText,
  confirmText,
  ...props
}: PromptArgs) {
  const inputs: FormInput[] = [
    {
      type: 'text',
      name: 'value',
      ...props,
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

  return result?.value ? String(result.value) : null;
}
