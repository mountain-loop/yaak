/**
 * Built-ins that PDF.js's modern build calls unconditionally but the system WebKit on
 * older macOS lacks: the upsert methods and `Math.sumPrecise` arrived in Safari 26.2,
 * and async iteration of `ReadableStream` in Safari 27. Without them the PDF viewer
 * throws as soon as it renders. Loaded first by `index.html`, and by `pdfWorker.ts`
 * because the worker has its own globals.
 *
 * Each is defined only when missing, so newer engines keep their native versions.
 */

type KeyedCollection<K, V> = {
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
};

/** https://tc39.es/proposal-upsert/#sec-map.prototype.getOrInsert */
export function getOrInsert<K, V>(this: KeyedCollection<K, V>, key: K, value: V): V {
  if (this.has(key)) return this.get(key) as V;
  this.set(key, value);
  return value;
}

/** https://tc39.es/proposal-upsert/#sec-map.prototype.getOrInsertComputed */
export function getOrInsertComputed<K, V>(
  this: KeyedCollection<K, V>,
  key: K,
  callbackfn: (key: K) => V,
): V {
  if (typeof callbackfn !== "function") {
    throw new TypeError("getOrInsertComputed callback is not a function");
  }
  if (this.has(key)) return this.get(key) as V;
  // Map keys are canonicalized, so -0 is stored and passed on as +0
  const k = (Object.is(key, -0) ? 0 : key) as K;
  const value = callbackfn(k);
  // The spec sets after the callback even if the callback inserted the key itself
  this.set(k, value);
  return value;
}

/**
 * https://tc39.es/proposal-math-sum/
 *
 * Shewchuk's exact summation with round-half-even on the final step (the algorithm
 * behind Python's `math.fsum`). A finite input set whose running sum overflows
 * partway through is not handled exactly, which PDF.js's byte lengths and widths
 * never come near.
 */
export function sumPrecise(items: Iterable<number>): number {
  const partials: number[] = [];
  let allNegativeZero = true;
  let sawNaN = false;
  let sawPositiveInfinity = false;
  let sawNegativeInfinity = false;

  for (const item of items) {
    if (typeof item !== "number") {
      throw new TypeError("Math.sumPrecise requires an iterable of numbers");
    }
    if (!Object.is(item, -0)) allNegativeZero = false;
    if (Number.isNaN(item)) {
      sawNaN = true;
    } else if (item === Infinity) {
      sawPositiveInfinity = true;
    } else if (item === -Infinity) {
      sawNegativeInfinity = true;
    } else {
      let x = item;
      let i = 0;
      for (let y of partials) {
        if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
        const hi = x + y;
        const lo = y - (hi - x);
        if (lo !== 0) partials[i++] = lo;
        x = hi;
      }
      partials.length = i;
      partials.push(x);
    }
  }

  if (sawNaN || (sawPositiveInfinity && sawNegativeInfinity)) return NaN;
  if (sawPositiveInfinity) return Infinity;
  if (sawNegativeInfinity) return -Infinity;
  if (allNegativeZero) return -0;

  let n = partials.length;
  let hi = 0;
  let lo = 0;
  if (n > 0) {
    hi = partials[--n] as number;
    while (n > 0) {
      const x = hi;
      const y = partials[--n] as number;
      hi = x + y;
      lo = y - (hi - x);
      if (lo !== 0) break;
    }
    const next = partials[n - 1];
    if (n > 0 && next != null && ((lo < 0 && next < 0) || (lo > 0 && next > 0))) {
      const y = lo * 2;
      const x = hi + y;
      if (y === x - hi) hi = x;
    }
  }
  return hi === 0 ? 0 : hi;
}

/** https://streams.spec.whatwg.org/#rs-asynciterator */
export async function* readableStreamValues<R>(
  this: ReadableStream<R>,
  { preventCancel = false }: { preventCancel?: boolean } = {},
): AsyncGenerator<R, undefined, undefined> {
  const reader = this.getReader();
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      yield value;
    }
  } catch (err) {
    finished = true;
    throw err;
  } finally {
    // Leaving the loop early (break, return, throw in the body) cancels the stream. The
    // lock is released even if cancelling rejects, which then propagates as in the spec.
    try {
      if (!finished && !preventCancel) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

function define(target: object, key: PropertyKey, value: unknown) {
  if (key in target) return;
  Object.defineProperty(target, key, { value, writable: true, configurable: true });
}

define(Map.prototype, "getOrInsert", getOrInsert);
define(Map.prototype, "getOrInsertComputed", getOrInsertComputed);
define(WeakMap.prototype, "getOrInsert", getOrInsert);
define(WeakMap.prototype, "getOrInsertComputed", getOrInsertComputed);
define(Math, "sumPrecise", sumPrecise);
if (typeof ReadableStream !== "undefined") {
  define(ReadableStream.prototype, "values", readableStreamValues);
  define(
    ReadableStream.prototype,
    Symbol.asyncIterator,
    Reflect.get(ReadableStream.prototype, "values"),
  );
}

// TypeScript's lib does not describe these yet
declare global {
  interface Map<K, V> {
    getOrInsert(key: K, value: V): V;
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
  }
  interface WeakMap<K extends WeakKey, V> {
    getOrInsert(key: K, value: V): V;
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
  }
  interface Math {
    sumPrecise(items: Iterable<number>): number;
  }
}
