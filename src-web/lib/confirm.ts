import type { ConfirmProps } from '../components/core/Confirm';
import { Confirm } from '../components/core/Confirm';
import type { DialogProps } from '../components/core/Dialog';
import { showDialog } from './dialog';

type ConfirmArgs = {
  id: string;
} & Pick<DialogProps, 'title' | 'description'> &
  Pick<ConfirmProps, 'variant' | 'confirmText'>;

export async function showConfirm({ id, title, description, variant, confirmText }: ConfirmArgs) {
  return new Promise((onResult: ConfirmProps['onResult']) => {
    showDialog({
      id,
      title,
      description,
      hideX: true,
      size: 'sm',
      disableBackdropClose: true, // Prevent accidental dismisses
      render: ({ hide }) => Confirm({ onHide: hide, variant, onResult, confirmText }),
    });
  });
}
