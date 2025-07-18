import type { ConfirmProps } from '../components/core/Confirm';
import { Confirm } from '../components/core/Confirm';
import type { DialogProps } from '../components/core/Dialog';
import { showDialog } from './dialog';

type ConfirmArgs = {
  id: string;
} & Pick<DialogProps, 'title' | 'description'> &
  Pick<ConfirmProps, 'color' | 'confirmText' | 'requireTyping'>;

export async function showConfirm({
  color,
  confirmText,
  requireTyping,
  ...extraProps
}: ConfirmArgs) {
  return new Promise((onResult: ConfirmProps['onResult']) => {
    showDialog({
      ...extraProps,
      hideX: true,
      size: 'sm',
      disableBackdropClose: true, // Prevent accidental dismisses
      render: ({ hide }) => Confirm({ onHide: hide, color, onResult, confirmText, requireTyping }),
    });
  });
}

export async function showConfirmDelete({ confirmText, color, ...extraProps }: ConfirmArgs) {
  return showConfirm({
    color: color ?? 'danger',
    confirmText: confirmText ?? 'Delete',
    ...extraProps,
  });
}
