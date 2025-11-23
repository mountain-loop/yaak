import type { DragMoveEvent } from '@dnd-kit/core';

export function computeSideForDragMove(id: string, e: DragMoveEvent): 'above' | 'below' | null {
  if (e.over == null || e.over.id !== id) {
    return null;
  }
  if (e.active.rect.current.initial == null) return null;

  const overRect = e.over.rect;
  const activeTop =
    e.active.rect.current.translated?.top ?? e.active.rect.current.initial.top + e.delta.y;
  const pointerY = activeTop + e.active.rect.current.initial.height / 2;

  const hoverTop = overRect.top;
  const hoverBottom = overRect.bottom;
  const hoverMiddleY = (hoverBottom - hoverTop) / 2;
  const hoverClientY = pointerY - hoverTop;

  return hoverClientY < hoverMiddleY ? 'above' : 'below';
}
