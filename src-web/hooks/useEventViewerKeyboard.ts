import type { Virtualizer } from '@tanstack/react-virtual';
import { useCallback } from 'react';
import { useKey } from 'react-use';

interface UseEventViewerKeyboardProps {
  totalCount: number;
  activeIndex: number | null;
  setActiveIndex: (index: number | null) => void;
  virtualizer?: Virtualizer<HTMLDivElement, Element> | null;
  isContainerFocused: () => boolean;
  enabled?: boolean;
}

export function useEventViewerKeyboard({
  totalCount,
  activeIndex,
  setActiveIndex,
  virtualizer,
  isContainerFocused,
  enabled = true,
}: UseEventViewerKeyboardProps) {
  const selectPrev = useCallback(() => {
    if (totalCount === 0) return;

    const newIndex = activeIndex == null ? 0 : Math.max(0, activeIndex - 1);
    setActiveIndex(newIndex);
    virtualizer?.scrollToIndex(newIndex, { align: 'auto' });
  }, [activeIndex, setActiveIndex, totalCount, virtualizer]);

  const selectNext = useCallback(() => {
    if (totalCount === 0) return;

    const newIndex = activeIndex == null ? 0 : Math.min(totalCount - 1, activeIndex + 1);
    setActiveIndex(newIndex);
    virtualizer?.scrollToIndex(newIndex, { align: 'auto' });
  }, [activeIndex, setActiveIndex, totalCount, virtualizer]);

  useKey(
    (e) => e.key === 'ArrowUp' || e.key === 'k',
    (e) => {
      if (!enabled || !isContainerFocused()) return;
      e.preventDefault();
      selectPrev();
    },
    undefined,
    [enabled, isContainerFocused, selectPrev],
  );

  useKey(
    (e) => e.key === 'ArrowDown' || e.key === 'j',
    (e) => {
      if (!enabled || !isContainerFocused()) return;
      e.preventDefault();
      selectNext();
    },
    undefined,
    [enabled, isContainerFocused, selectNext],
  );

  useKey(
    (e) => e.key === 'Escape',
    (e) => {
      if (!enabled || !isContainerFocused()) return;
      e.preventDefault();
      setActiveIndex(null);
    },
    undefined,
    [enabled, isContainerFocused, setActiveIndex],
  );
}
