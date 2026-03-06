import { useCallback } from 'react';
import { CommandPaletteDialog } from '../components/CommandPaletteDialog';
import { toggleDialog } from '../lib/dialog';

export function useToggleCommandPalette() {
  const togglePalette = useCallback(() => {
    toggleDialog({
      id: 'command_palette',
      size: 'dynamic',
      hideX: true,
      className: 'mb-auto mt-[4rem] !max-h-[min(30rem,calc(100vh-4rem))]',
      vAlign: 'top',
      noPadding: true,
      noScroll: true,
      render: ({ hide }) => <CommandPaletteDialog onClose={hide} />,
    });
  }, []);

  return togglePalette;
}
