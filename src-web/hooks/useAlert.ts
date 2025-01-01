import { useCallback } from 'react';
import type { DialogProps } from '../components/core/Dialog';
import type { AlertProps } from './Alert';
import { Alert } from './Alert';
import {useDialog} from "./useDialog";

interface AlertArg {
  id: string;
  title: DialogProps['title'];
  body: AlertProps['body'];
  size?: DialogProps['size'];
}

export function useAlert() {
  const dialog = useDialog();
  return useCallback<(a: AlertArg) => void>(
    ({ id, title, body, size = 'sm' }: AlertArg) =>
      dialog.show({
        id,
        title,
        hideX: true,
        size,
        render: ({ hide }) => Alert({ onHide: hide, body }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
