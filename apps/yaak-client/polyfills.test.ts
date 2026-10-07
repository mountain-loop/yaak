import { describe, expect, test, vi } from "vite-plus/test";
import { getOrInsert, getOrInsertComputed, readableStreamValues, sumPrecise } from "./polyfills";

describe("getOrInsert", () => {
  test("returns the existing value without replacing it", () => {
    const map = new Map([["a", 1]]);
    expect(getOrInsert.call(map, "a", 2)).toBe(1);
    expect(map.get("a")).toBe(1);
  });

  test("inserts and returns the value for a missing key", () => {
    const map = new Map<string, number>();
    expect(getOrInsert.call(map, "a", 2)).toBe(2);
    expect(map.get("a")).toBe(2);
  });

  test("works on a WeakMap", () => {
    const key = {};
    const map = new WeakMap<object, number>();
    expect(getOrInsert.call(map, key, 1)).toBe(1);
    expect(getOrInsert.call(map, key, 2)).toBe(1);
  });
});

describe("getOrInsertComputed", () => {
  test("returns the existing value without calling the callback", () => {
    const map = new Map([["a", 1]]);
    const callback = vi.fn(() => 2);
    expect(getOrInsertComputed.call(map, "a", callback)).toBe(1);
    expect(callback).not.toHaveBeenCalled();
  });

  test("calls the callback with the key and inserts its result", () => {
    const map = new Map<string, string>();
    expect(getOrInsertComputed.call(map, "a", (key) => `${String(key)}!`)).toBe("a!");
    expect(map.get("a")).toBe("a!");
  });

  test("stores what the callback returns even if the callback set the key", () => {
    const map = new Map<string, number>();
    const result = getOrInsertComputed.call(map, "a", () => {
      map.set("a", 1);
      return 2;
    });
    expect(result).toBe(2);
    expect(map.get("a")).toBe(2);
  });

  test("canonicalizes -0 to +0", () => {
    const map = new Map<number, number>();
    getOrInsertComputed.call(map, -0, (key) => {
      expect(Object.is(key, 0)).toBe(true);
      return 1;
    });
    expect(Object.is([...map.keys()][0], 0)).toBe(true);
  });

  test("throws when the callback is not a function, even for an existing key", () => {
    const map = new Map([["a", 1]]);
    // @ts-expect-error testing a non-callable callback
    expect(() => getOrInsertComputed.call(map, "a", 1)).toThrow(TypeError);
  });

  test("is installed on Map and WeakMap", () => {
    const map = new Map<string, number[]>();
    map.getOrInsertComputed("a", () => []).push(1);
    map.getOrInsertComputed("a", () => []).push(2);
    expect(map.get("a")).toEqual([1, 2]);

    const key = {};
    const weakMap = new WeakMap<object, number>();
    expect(weakMap.getOrInsertComputed(key, () => 1)).toBe(1);
    expect(weakMap.getOrInsert(key, 2)).toBe(1);
  });
});

describe("sumPrecise", () => {
  test("sums without intermediate rounding", () => {
    expect(sumPrecise([1e20, 0.1, -1e20])).toBe(0.1);
    expect(sumPrecise([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumPrecise(Array.from({ length: 10 }, () => 0.1))).toBe(1);
  });

  test("rounds half to even on the final step", () => {
    expect(sumPrecise([1, 1e-16, 1e-16])).toBe(1.0000000000000002);
    expect(sumPrecise([1, 2 ** -53])).toBe(1);
  });

  test("handles zeroes, infinities and NaN like the spec", () => {
    expect(Object.is(sumPrecise([]), -0)).toBe(true);
    expect(Object.is(sumPrecise([-0, -0]), -0)).toBe(true);
    expect(Object.is(sumPrecise([-0, 0]), 0)).toBe(true);
    expect(Object.is(sumPrecise([1, -1]), 0)).toBe(true);
    expect(sumPrecise([1, Infinity])).toBe(Infinity);
    expect(sumPrecise([1, -Infinity])).toBe(-Infinity);
    expect(sumPrecise([Infinity, -Infinity])).toBeNaN();
    expect(sumPrecise([1, NaN])).toBeNaN();
  });

  test("accepts any iterable and rejects non-numbers", () => {
    expect(sumPrecise(new Set([1, 2, 3]))).toBe(6);
    // @ts-expect-error testing a non-number item
    expect(() => sumPrecise([1, "2"])).toThrow(TypeError);
  });

  test("is installed on Math", () => {
    expect(Math.sumPrecise([1, 2, 3])).toBe(6);
  });
});

describe("readableStreamValues", () => {
  const values = readableStreamValues<number>;

  function streamOf(chunks: number[], onCancel?: () => void) {
    return new ReadableStream<number>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
      cancel: onCancel,
    });
  }

  test("yields every chunk and releases the lock", async () => {
    const stream = streamOf([1, 2, 3]);
    const seen: number[] = [];
    for await (const chunk of values.call(stream)) seen.push(chunk);
    expect(seen).toEqual([1, 2, 3]);
    expect(stream.locked).toBe(false);
  });

  test("cancels the stream when the loop exits early", async () => {
    const onCancel = vi.fn();
    const stream = new ReadableStream<number>({
      pull(controller) {
        controller.enqueue(1);
      },
      cancel: onCancel,
    });
    for await (const _ of values.call(stream)) break;
    expect(onCancel).toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  });

  test("leaves the stream open with preventCancel", async () => {
    const onCancel = vi.fn();
    const stream = streamOf([1, 2], onCancel);
    for await (const _ of values.call(stream, { preventCancel: true })) break;
    expect(onCancel).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  });

  test("releases the lock and rethrows when cancelling rejects", async () => {
    const stream = new ReadableStream<number>({
      pull(controller) {
        controller.enqueue(1);
      },
      cancel() {
        throw new Error("cancel failed");
      },
    });
    await expect(async () => {
      for await (const _ of values.call(stream)) break;
    }).rejects.toThrow("cancel failed");
    expect(stream.locked).toBe(false);
  });
});
