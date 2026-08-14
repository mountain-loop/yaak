import { platform } from "./registry";
import type { CapabilityName } from "./types";

/**
 * Whether the current host supports a feature.
 *
 * A hook so components can gate on it directly, and so this can become reactive
 * later — a browser tab gains and loses capabilities when the local bridge comes
 * and goes. Capabilities are fixed for the life of the desktop app, so today it
 * is a plain read.
 */
export function useCapability(name: CapabilityName): boolean {
  return platform.capabilities[name];
}
