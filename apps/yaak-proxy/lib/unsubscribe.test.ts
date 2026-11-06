import { describe, expect, test, vi } from "vite-plus/test";
import { unsubscribeWhenReady } from "./unsubscribe";

function pending() {
  let resolve: (fn: () => void) => void = () => {};
  const promise = new Promise<() => void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("unsubscribeWhenReady", () => {
  test("unsubscribes once ready when cleanup ran first", async () => {
    const { promise, resolve } = pending();
    const unsub = vi.fn();
    const subscription = unsubscribeWhenReady(promise);
    subscription.unsubscribe();
    expect(subscription.active()).toBe(false);
    resolve(unsub);
    await promise;
    await Promise.resolve();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  test("unsubscribes at once when already ready, and only once", async () => {
    const unsub = vi.fn();
    const promise = Promise.resolve(unsub);
    const subscription = unsubscribeWhenReady(promise);
    await promise;
    await Promise.resolve();
    expect(subscription.active()).toBe(true);
    subscription.unsubscribe();
    subscription.unsubscribe();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
