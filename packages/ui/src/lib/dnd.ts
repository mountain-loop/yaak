import type { DragMoveEvent } from '@dnd-kit/core';

export function computeSideForDragMove(
  id: string,
  e: DragMoveEvent,
  orientation: 'vertical' | 'horizontal' = 'vertical',
): 'before' | 'after' | null {
  if (e.over == null || e.over.id !== id) {
    return null;
  }
  if (e.active.rect.current.initial == null) return null;

  const overRect = e.over.rect;

  if (orientation === 'horizontal') {
    // For horizontal layouts (tabs side-by-side), use left/right logic
    const activeLeft =
      e.active.rect.current.translated?.left ?? e.active.rect.current.initial.left + e.delta.x;
    const pointerX = activeLeft + e.active.rect.current.initial.width / 2;

    const hoverLeft = overRect.left;
    const hoverRight = overRect.right;
    const hoverMiddleX = hoverLeft + (hoverRight - hoverLeft) / 2;

    return pointerX < hoverMiddleX ? 'before' : 'after'; // 'before' = left, 'after' = right
  } else {
    // For vertical layouts, use top/bottom logic
    const activeTop =
      e.active.rect.current.translated?.top ?? e.active.rect.current.initial.top + e.delta.y;
    const pointerY = activeTop + e.active.rect.current.initial.height / 2;

    const hoverTop = overRect.top;
    const hoverBottom = overRect.bottom;
    const hoverMiddleY = (hoverBottom - hoverTop) / 2;
    const hoverClientY = pointerY - hoverTop;

    return hoverClientY < hoverMiddleY ? 'before' : 'after';
  }
}
