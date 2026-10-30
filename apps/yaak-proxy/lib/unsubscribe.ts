/**
 * An unsubscribe for a subscription that is still being set up. Called before the setup
 * resolves, it unsubscribes as soon as it does; `active` says whether to still deliver events.
 */
export function unsubscribeWhenReady(subscription: Promise<() => void>): {
  unsubscribe: () => void;
  active: () => boolean;
} {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  subscription
    .then((fn) => {
      if (cancelled) fn();
      else unsub = fn;
    })
    .catch(console.error);
  return {
    unsubscribe: () => {
      cancelled = true;
      unsub?.();
      unsub = null;
    },
    active: () => !cancelled,
  };
}
