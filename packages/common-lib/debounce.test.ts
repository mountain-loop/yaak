import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls once with the latest args after the delay", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d("a");
    d("b");
    d("c");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("flush invokes a pending call immediately", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d("a");
    d("b");
    d.flush();
    expect(fn).toHaveBeenCalledExactlyOnceWith("b");

    // The scheduled call was cancelled, so waiting out the delay adds nothing
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("flush is a no-op with nothing pending", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d.flush();
    expect(fn).not.toHaveBeenCalled();

    d("a");
    vi.advanceTimersByTime(100);
    d.flush();
    expect(fn).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("cancel drops the pending call and its args", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d("a");
    d.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();

    // A cancelled call must not leak its args into the next one
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it("starts a fresh delay after firing", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d("a");
    vi.advanceTimersByTime(100);
    d("b");
    vi.advanceTimersByTime(99);
    expect(fn).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });
});
