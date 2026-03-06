import type { FormInput, JsonPrimitive } from '@yaakapp-internal/plugins';
import type { DialogProps } from '../components/core/Dialog';
import type { PromptProps } from '../components/core/Prompt';
import { Prompt } from '../components/core/Prompt';
import { showDialog } from './dialog';

type FormArgs = Pick<DialogProps, 'title' | 'description' | 'size'> &
  Omit<PromptProps, 'onClose' | 'onCancel' | 'onResult'> & {
    id: string;
    onValuesChange?: (values: Record<string, JsonPrimitive>) => void;
    onInputsUpdated?: (cb: (inputs: FormInput[]) => void) => void;
  };

export async function showPromptForm({
  id,
  title,
  description,
  size,
  onValuesChange,
  onInputsUpdated,
  ...props
}: FormArgs) {
  return new Promise((resolve: PromptProps['onResult']) => {
    showDialog({
      id,
      title,
      description,
      hideX: true,
      size: size ?? 'sm',
      disableBackdropClose: true, // Prevent accidental dismisses
      onClose: () => {
        // Click backdrop, close, or escape
        resolve(null);
      },
      render: ({ hide }) =>
        Prompt({
          onCancel: () => {
            // Click cancel button within dialog
            resolve(null);
            hide();
          },
          onResult: (v) => {
            resolve(v);
            hide();
          },
          onValuesChange,
          onInputsUpdated,
          ...props,
        }),
    });
  });
}
