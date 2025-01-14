import type { DialogProps } from '../components/core/Dialog';
import type { PromptProps } from '../components/core/Prompt';
import { Prompt } from '../components/core/Prompt';
import { showDialog } from './dialog';

type PromptArgs = Pick<DialogProps, 'title' | 'description'> &
  Omit<PromptProps, 'onClose' | 'onCancel' | 'onResult'> & { id: string };

export async function showPrompt({ id, title, description, ...props }: PromptArgs) {
  return new Promise((resolve: PromptProps['onResult']) => {
    showDialog({
      id,
      title,
      description,
      hideX: true,
      size: 'sm',
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
          ...props,
        }),
    });
  });
}
