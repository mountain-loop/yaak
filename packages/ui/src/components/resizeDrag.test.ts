import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { ResizeHandleEvent } from "./ResizeHandle";
import {
  clampSplitRatio,
  createFrameCoalescer,
  createHandleDrag,
  createSidebarDrag,
  createSplitDrag,
} from "./resizeDrag";

let frames: Map<number, FrameRequestCallback>;

function runFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const cb of callbacks) cb(0);
}

beforeEach(() => {
  frames = new Map();
  let nextId = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => vi.unstubAllGlobals());

const at = (x: number, y = 0): ResizeHandleEvent => ({ x, y, xStart: 500, yStart: 400 });

describe("createFrameCoalescer", () => {
  test("delivers only the latest of many values pushed in one frame", () => {
    const fn = vi.fn<(v: number) => void>();
    const moves = createFrameCoalescer(fn);
    for (let i = 1; i <= 50; i++) moves.push(i);

    expect(fn).not.toHaveBeenCalled();
    runFrame();
    expect(fn.mock.calls).toEqual([[50]]);

    runFrame();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("delivers once per frame across frames", () => {
    const fn = vi.fn<(v: number) => void>();
    const moves = createFrameCoalescer(fn);
    moves.push(1);
    moves.push(2);
    runFrame();
    moves.push(3);
    runFrame();
    expect(fn.mock.calls).toEqual([[2], [3]]);
  });

  test("flush delivers the pending value now and drops its frame", () => {
    const fn = vi.fn<(v: number) => void>();
    const moves = createFrameCoalescer(fn);
    moves.push(1);
    moves.push(2);
    moves.flush();

    expect(fn.mock.calls).toEqual([[2]]);
    expect(frames.size).toBe(0);
    moves.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("cancel drops the pending value", () => {
    const fn = vi.fn<(v: number) => void>();
    const moves = createFrameCoalescer(fn);
    moves.push(1);
    moves.cancel();
    runFrame();
    moves.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});

describe("createHandleDrag", () => {
  function handle(vertical = false) {
    const calls: string[] = [];
    const drag = createHandleDrag({
      vertical,
      xStart: 500,
      yStart: 400,
      onResizeStart: () => calls.push("start"),
      onResizeMove: (e) => calls.push(`move ${e.x},${e.y}`),
      onResizeEnd: () => calls.push("end"),
    });
    return { drag, calls };
  }

  test("starts only once the pointer has moved more than 7px along its axis", () => {
    const { drag, calls } = handle();
    drag.move({ clientX: 505, clientY: 900 });
    expect(calls).toEqual([]);
    drag.move({ clientX: 492, clientY: 400 });
    expect(calls).toEqual(["start"]);

    const v = handle(true);
    v.drag.move({ clientX: 900, clientY: 405 });
    v.drag.move({ clientX: 900, clientY: 408 });
    expect(v.calls).toEqual(["start"]);
  });

  test("coalesces many moves in a frame into one, and delivers the last before end", () => {
    const { drag, calls } = handle();
    drag.move({ clientX: 480, clientY: 400 });
    for (let i = 1; i <= 50; i++) drag.move({ clientX: 480 - i, clientY: 400 });
    runFrame();
    expect(calls).toEqual(["start", "move 430,400"]);

    drag.move({ clientX: 420, clientY: 400 });
    drag.move({ clientX: 410, clientY: 400 });
    drag.up();
    expect(calls).toEqual(["start", "move 430,400", "move 410,400", "end"]);

    runFrame();
    expect(calls).toHaveLength(4);
  });

  test("ends on release even when no drag started, like a click", () => {
    const { drag, calls } = handle();
    drag.up();
    expect(calls).toEqual(["end"]);
  });

  test("abort drops the pending move and ends only a started drag", () => {
    const idle = handle();
    idle.drag.abort();
    expect(idle.calls).toEqual([]);

    const { drag, calls } = handle();
    drag.move({ clientX: 480, clientY: 400 });
    drag.move({ clientX: 470, clientY: 400 });
    drag.abort();
    runFrame();
    expect(calls).toEqual(["start", "end"]);
    expect(frames.size).toBe(0);
  });
});

describe("createSplitDrag", () => {
  function split(overrides: Partial<Parameters<typeof createSplitDrag>[0]> = {}) {
    const apply = vi.fn<(r: number) => void>();
    const commit = vi.fn<(r: number) => void>();
    const drag = createSplitDrag({
      vertical: false,
      startRatio: 0.5,
      minPx: 10,
      measure: () => 1000,
      apply,
      commit,
      ...overrides,
    });
    return { drag, apply, commit };
  }

  test("applies every move and commits the last ratio once, on end", () => {
    const { drag, apply, commit } = split();
    for (let i = 1; i <= 50; i++) drag.move(at(500 - i * 4));

    expect(apply).toHaveBeenCalledTimes(50);
    expect(commit).not.toHaveBeenCalled();

    drag.end();
    expect(commit.mock.calls).toEqual([[0.7]]);
  });

  test("anchors each move to where the drag started rather than compounding", () => {
    const { drag, commit } = split({ startRatio: 0.25 });
    drag.move(at(400));
    drag.move(at(400));
    drag.move(at(450));
    drag.end();
    expect(commit.mock.calls).toEqual([[0.3]]);
  });

  test("follows y when vertical", () => {
    const { drag, commit } = split({ vertical: true, measure: () => 800 });
    drag.move(at(0, 200));
    drag.end();
    expect(commit.mock.calls).toEqual([[0.75]]);
  });

  test("keeps both panes at least minPx", () => {
    const { drag, apply, commit } = split({ minPx: 100 });
    drag.move(at(-5000));
    expect(apply).toHaveBeenLastCalledWith(0.9);
    drag.move(at(5000));
    drag.end();
    expect(commit.mock.calls).toEqual([[0.1]]);
  });

  test("ignores moves while the container has no size", () => {
    const { drag, apply, commit } = split({ measure: () => 0 });
    drag.move(at(300));
    drag.end();
    expect(apply).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  test("commits nothing when it never moved", () => {
    const { drag, commit } = split();
    drag.end();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("clampSplitRatio", () => {
  test("clamps to the min size on either side", () => {
    expect(clampSplitRatio(0.01, 100, 1000)).toBe(0.1);
    expect(clampSplitRatio(0.99, 100, 1000)).toBe(0.9);
    expect(clampSplitRatio(0.4, 100, 1000)).toBe(0.4);
  });

  test("leaves the ratio alone with no size or no minimum", () => {
    expect(clampSplitRatio(0.01, 100, 0)).toBe(0.01);
    expect(clampSplitRatio(0.01, 0, 1000)).toBe(0.01);
  });
});

describe("createSidebarDrag", () => {
  function sidebar() {
    const apply = vi.fn();
    const commit = vi.fn();
    const drag = createSidebarDrag({
      startWidth: 250,
      minWidth: 50,
      defaultWidth: 250,
      apply,
      commit,
    });
    return { drag, apply, commit };
  }

  test("commits the last width once, on end", () => {
    const { drag, apply, commit } = sidebar();
    for (let i = 1; i <= 50; i++) drag.move({ x: 500 + i * 2, y: 0, xStart: 500, yStart: 0 });

    expect(apply).toHaveBeenCalledTimes(50);
    expect(commit).not.toHaveBeenCalled();
    drag.end();
    expect(commit.mock.calls).toEqual([[{ width: 350, hidden: false }]]);
  });

  test("collapses under the min width and reopens when dragged back out", () => {
    const { drag, apply, commit } = sidebar();
    drag.move({ x: 290, y: 0, xStart: 500, yStart: 0 });
    expect(apply).toHaveBeenLastCalledWith({ width: 250, hidden: true });

    drag.move({ x: 340, y: 0, xStart: 500, yStart: 0 });
    expect(apply).toHaveBeenLastCalledWith({ width: 90, hidden: false });

    drag.move({ x: 200, y: 0, xStart: 500, yStart: 0 });
    drag.end();
    expect(commit.mock.calls).toEqual([[{ width: 250, hidden: true }]]);
  });

  test("commits nothing when it never moved", () => {
    const { drag, commit } = sidebar();
    drag.end();
    expect(commit).not.toHaveBeenCalled();
  });
});
