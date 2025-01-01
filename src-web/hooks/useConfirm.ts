import type { DialogProps } from '../components/core/Dialog';
import type { ConfirmProps } from './Confirm';
import { Confirm } from './Confirm';
import { useDialog } from './useDialog';

export function useConfirm() {
  const dialog = useDialog();
  return ({
    id,
    title,
    description,
    variant,
    confirmText,
  }: {
    id: string;
    title: DialogProps['title'];
    description?: DialogProps['description'];
    variant?: ConfirmProps['variant'];
    confirmText?: ConfirmProps['confirmText'];
  }) =>
    new Promise((onResult: ConfirmProps['onResult']) => {
      dialog.show({
        id,
        title,
        description,
        hideX: true,
        size: 'sm',
        render: ({ hide }) => Confirm({ onHide: hide, variant, onResult, confirmText }),
      });
    });
}
