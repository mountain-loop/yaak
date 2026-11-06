import { clamp } from "../lib/clamp";
import type { ResizeHandleEvent } from "./ResizeHandle";

/**
 * Coalesces values pushed faster than the screen refreshes: `fn` gets the latest value at most once
 * per animation frame. `flush` delivers a pending value now, `cancel` drops it.
 */
export function createFrameCoalescer<T>(fn: (value: T) => void) {
  let frame: number | null = null;
  let pending: { value: T } | null = null;

  function cancelFrame() {
    if (frame != null) cancelAnimationFrame(frame);
    frame = null;
  }

  function flush() {
    cancelFrame();
    if (pending == null) return;
    const { value } = pending;
    pending = null;
    fn(value);
  }

  return {
    push(value: T) {
      pending = { value };
      if (frame == null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          flush();
        });
      }
    },
    flush,
    cancel() {
      cancelFrame();
      pending = null;
    },
  };
}

const START_DISTANCE = 7;

/**
 * One press of a ResizeHandle. Nothing happens until the pointer has moved more than a few px
 * along the handle's axis; after that, moves reach `onResizeMove` at most once per animation frame,
 * and the last one always arrives before `onResizeEnd`.
 */
export function createHandleDrag({
  vertical,
  xStart,
  yStart,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: {
  vertical: boolean;
  xStart: number;
  yStart: number;
  onResizeStart?: () => void;
  onResizeMove?: (e: ResizeHandleEvent) => void;
  onResizeEnd?: () => void;
}) {
  let started = false;
  const moves = createFrameCoalescer((e: { clientX: number; clientY: number }) => {
    onResizeMove?.({ x: e.clientX, y: e.clientY, xStart, yStart });
  });

  return {
    move(e: { clientX: number; clientY: number }) {
      if (started) {
        moves.push(e);
        return;
      }

      const distance = Math.abs(vertical ? yStart - e.clientY : xStart - e.clientX);
      if (distance > START_DISTANCE) {
        started = true;
        onResizeStart?.();
      }
    },
    /** The pointer was released */
    up() {
      moves.flush();
      onResizeEnd?.();
    },
    /** The handle went away mid-press; a drag that had started still ends */
    abort() {
      moves.cancel();
      if (started) onResizeEnd?.();
    },
  };
}

export function splitGridTemplate(vertical: boolean, ratio: number): string {
  return vertical
    ? `
            ' left' minmax(0,${1 - ratio}fr)
            ' drag' 0
            ' right' minmax(0,${ratio}fr)
            / 1fr
          `
    : `
            ' left drag right' minmax(0,1fr)
            / ${1 - ratio}fr    0                 ${ratio}fr
          `;
}

export function clampSplitRatio(ratio: number, minPx: number, containerPx: number): number {
  if (containerPx <= 0 || minPx <= 0) {
    return ratio;
  }

  const minRatio = Math.min(1, minPx / containerPx);
  const maxRatio = minRatio >= 0.5 ? minRatio : 1 - minRatio;
  return clamp(ratio, minRatio, maxRatio);
}

/**
 * One drag of a SplitLayout handle. The ratio of the second pane follows the pointer from where it
 * was when the drag started, is shown with `apply` as it changes, and is handed to `commit` once,
 * when the drag ends.
 */
export function createSplitDrag({
  vertical,
  startRatio,
  minPx,
  measure,
  apply,
  commit,
}: {
  vertical: boolean;
  startRatio: number;
  minPx: number;
  /** The container's content size along the drag axis, in px */
  measure: () => number;
  apply: (ratio: number) => void;
  commit: (ratio: number) => void;
}) {
  let ratio: number | null = null;

  return {
    vertical,
    get ratio() {
      return ratio;
    },
    move(e: ResizeHandleEvent) {
      const containerPx = measure();
      if (containerPx <= 0) return;

      const startPx = containerPx * startRatio;
      const deltaPx = vertical ? e.y - e.yStart : e.x - e.xStart;
      const min = Math.min(minPx, containerPx);
      const max = Math.max(min, containerPx - minPx);
      ratio = clamp(startPx - deltaPx, min, max) / containerPx;
      apply(ratio);
    },
    end() {
      if (ratio != null) commit(ratio);
    },
  };
}

export type SplitDrag = ReturnType<typeof createSplitDrag>;

export function sidebarGridTemplate(sideWidth: number): string {
  return `
        ' side drag body' minmax(0,1fr)
        / ${sideWidth}px   0                1fr`;
}

export interface SidebarSize {
  width: number;
  hidden: boolean;
}

/**
 * One drag of the SidebarLayout handle. Dragging under `minWidth` collapses the sidebar (and
 * resets its width to `defaultWidth`, for when it is shown again); dragging back out reopens it.
 * Each change is shown with `apply`, and the result is handed to `commit` once, when the drag ends.
 */
export function createSidebarDrag({
  startWidth,
  minWidth,
  defaultWidth,
  apply,
  commit,
}: {
  startWidth: number;
  minWidth: number;
  defaultWidth: number;
  apply: (size: SidebarSize) => void;
  commit: (size: SidebarSize) => void;
}) {
  let size: SidebarSize | null = null;

  return {
    get size() {
      return size;
    },
    move({ x, xStart }: ResizeHandleEvent) {
      const newWidth = startWidth + (x - xStart);
      size =
        newWidth < minWidth
          ? { width: defaultWidth, hidden: true }
          : { width: newWidth, hidden: false };
      apply(size);
    },
    end() {
      if (size != null) commit(size);
    },
  };
}

export type SidebarDrag = ReturnType<typeof createSidebarDrag>;
