// AutoScrollWhileDragging.tsx
import { useEffect, useRef } from 'react';
import { useDragLayer } from 'react-dnd';

type Props = {
  container: HTMLElement | null | undefined;
  edgeDistance?: number;
  maxSpeedPerFrame?: number;
};

export function AutoScrollWhileDragging({
  container,
  edgeDistance = 30,
  maxSpeedPerFrame = 6,
}: Props) {
  const rafId = useRef<number | null>(null);

  const { isDragging, pointer } = useDragLayer((monitor) => ({
    isDragging: monitor.isDragging(),
    pointer: monitor.getClientOffset(), // { x, y } | null
  }));

  useEffect(() => {
    if (!container || !isDragging) {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
      return;
    }

    const tick = () => {
      if (!container || !isDragging || !pointer) return;

      const rect = container.getBoundingClientRect();
      const y = pointer.y;

      // Compute vertical speed based on proximity to edges
      let dy = 0;
      if (y < rect.top + edgeDistance) {
        const t = (rect.top + edgeDistance - y) / edgeDistance; // 0..1
        dy = -Math.min(maxSpeedPerFrame, Math.ceil(t * maxSpeedPerFrame));
      } else if (y > rect.bottom - edgeDistance) {
        const t = (y - (rect.bottom - edgeDistance)) / edgeDistance; // 0..1
        dy = Math.min(maxSpeedPerFrame, Math.ceil(t * maxSpeedPerFrame));
      }

      if (dy !== 0) {
        // Only scroll if there’s more content in that direction
        const prev = container.scrollTop;
        container.scrollTop = prev + dy;
      }

      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
  }, [container, isDragging, pointer, edgeDistance, maxSpeedPerFrame]);

  return null;
}
