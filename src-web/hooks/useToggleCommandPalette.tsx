import { useCallback } from 'react';
import { CommandPalette } from '../components/CommandPalette';
import { useDialog } from './useDialog';

export function useToggleCommandPalette() {
  const dialog = useDialog();
  const togglePalette = useCallback(() => {
    dialog.toggle({
      id: 'command_palette',
      size: 'dynamic',
      hideX: true,
      className: '!max-h-[min(30rem,calc(100vh-4rem))]',
      vAlign: 'top',
      noPadding: true,
      noScroll: true,
      render: ({ hide }) => <CommandPalette onClose={hide} />,
    });
  }, [dialog]);

  return togglePalette;
}
