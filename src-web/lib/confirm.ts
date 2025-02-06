import type { ConfirmProps } from '../components/core/Confirm';
import { Confirm } from '../components/core/Confirm';
import type { DialogProps } from '../components/core/Dialog';
import { showDialog } from './dialog';

type ConfirmArgs = {
  id: string;
} & Pick<DialogProps, 'title' | 'description'> &
  Pick<ConfirmProps, 'color' | 'confirmText'>;

export async function showConfirm({ id, title, description, color, confirmText }: ConfirmArgs) {
  return new Promise((onResult: ConfirmProps['onResult']) => {
    showDialog({
      id,
      title,
      description,
      hideX: true,
      size: 'sm',
      disableBackdropClose: true, // Prevent accidental dismisses
      render: ({ hide }) => Confirm({ onHide: hide, color, onResult, confirmText }),
    });
  });
}

export async function showConfirmDelete({ id, title, description }: ConfirmArgs) {
  return showConfirm({
    id,
    title,
    description,
    color: 'danger',
    confirmText: 'Delete',
  });
}
