import { useAtomValue } from 'jotai';
import type { ComponentType } from 'react';
import React, { useCallback } from 'react';
import { dialogsAtom, hideDialog } from '../lib/dialog';
import { Dialog, type DialogProps } from './core/Dialog';
import { ErrorBoundary } from './ErrorBoundary';

export type DialogInstance = {
  id: string;
  render: ComponentType<{ hide: () => void }>;
} & Omit<DialogProps, 'open' | 'children'>;

export function Dialogs() {
  const dialogs = useAtomValue(dialogsAtom);
  return (
    <>
      {dialogs.map(({ id, ...props }) => (
        <DialogInstance key={id} id={id} {...props} />
      ))}
    </>
  );
}

function DialogInstance({ render: Component, onClose, id, ...props }: DialogInstance) {
  const hide = useCallback(() => {
    hideDialog(id);
  }, [id]);

  const handleClose = useCallback(() => {
    onClose?.();
    hideDialog(id);
  }, [id, onClose]);

  return (
    <ErrorBoundary name={`Dialog ${id}`}>
      <Dialog open onClose={handleClose} {...props}>
        <Component hide={hide} {...props} />
      </Dialog>
    </ErrorBoundary>
  );
}
