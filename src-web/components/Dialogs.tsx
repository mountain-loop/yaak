import React, { useContext, useMemo, useState } from 'react';
import { trackEvent } from '../lib/analytics';
import { Dialog, type DialogProps } from './core/Dialog';
import { DialogContext } from './DialogContext';

type DialogEntry = {
  id: string;
  render: ({ hide }: { hide: () => void }) => React.ReactNode;
} & Omit<DialogProps, 'open' | 'children'>;

export interface DialogState {
  dialogs: DialogEntry[];
  actions: Actions;
}

interface Actions {
  show: (d: DialogEntry) => void;
  toggle: (d: DialogEntry) => void;
  hide: (id: string) => void;
}

export const DialogProvider = ({ children }: { children: React.ReactNode }) => {
  const [dialogs, setDialogs] = useState<DialogState['dialogs']>([]);
  const actions = useMemo<Actions>(
    () => ({
      show({ id, ...props }: DialogEntry) {
        trackEvent('dialog', 'show', { id });
        setDialogs((a) => [...a.filter((d) => d.id !== id), { id, ...props }]);
      },
      toggle({ id, ...props }: DialogEntry) {
        if (dialogs.some((d) => d.id === id)) this.hide(id);
        else this.show({ id, ...props });
      },
      hide: (id: string) => {
        setDialogs((a) => a.filter((d) => d.id !== id));
      },
    }),
    [dialogs],
  );

  const state: DialogState = {
    dialogs,
    actions,
  };

  return <DialogContext.Provider value={state}>{children}</DialogContext.Provider>;
};

function DialogInstance({ id, render, onClose, ...props }: DialogEntry) {
  const { actions } = useContext(DialogContext);
  const children = render({ hide: () => actions.hide(id) });
  return (
    <Dialog
      open
      onClose={() => {
        onClose?.();
        actions.hide(id);
      }}
      {...props}
    >
      {children}
    </Dialog>
  );
}

export function Dialogs() {
  const { dialogs } = useContext(DialogContext);
  return (
    <>
      {dialogs.map((props: DialogEntry) => (
        <DialogInstance key={props.id} {...props} />
      ))}
    </>
  );
}
