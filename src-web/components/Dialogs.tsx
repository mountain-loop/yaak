import { useAtomValue } from 'jotai';
import React from 'react';
import { dialogsAtom, hideDialog } from '../lib/dialog';
import { Dialog, type DialogProps } from './core/Dialog';

export type DialogInstance = {
  id: string;
  render: ({ hide }: { hide: () => void }) => React.ReactNode;
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

function DialogInstance({ render, onClose, id, ...props }: DialogInstance) {
  const children = render({ hide: () => hideDialog(id) });
  return (
    <Dialog
      open
      key={id}
      onClose={() => {
        onClose?.();
        hideDialog(id);
      }}
      {...props}
    >
      {children}
    </Dialog>
  );
}
