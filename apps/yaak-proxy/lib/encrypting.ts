import type { GetProxyStateResponse } from "@yaakapp-internal/proxy-lib";

/**
 * How far encrypting traffic stored before encryption has got, as "42%", while it runs; null
 * otherwise. Rounded down, so it reads 100% only once it is done.
 */
export function encryptingPercent(state: GetProxyStateResponse | null | undefined): string | null {
  const fraction = state?.encrypting;
  if (fraction == null) return null;
  return `${Math.floor(Math.min(Math.max(fraction, 0), 1) * 100)}%`;
}
