import type { DialogProps } from '../components/core/Dialog';
import type { PromptProps } from './Prompt';
import { Prompt } from './Prompt';
import {useDialog} from "./useDialog";

type Props = Pick<DialogProps, 'title' | 'description'> &
  Omit<PromptProps, 'onClose' | 'onCancel' | 'onResult'> & { id: string };

export function usePrompt() {
  const dialog = useDialog();
  return ({ id, title, description, ...props }: Props) =>
    new Promise((resolve: PromptProps['onResult']) => {
      dialog.show({
        id,
        title,
        description,
        hideX: true,
        size: 'sm',
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
