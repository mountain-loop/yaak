import { createBridgePlatform } from "./bridge";
import { bridgeConfig, promptForToken, shouldUseBridge } from "./connect";
import { setPlatform } from "./registry";
import { createTauriPlatform } from "./tauri";

// This line is the swap point, and it has to run synchronously: several modules
// call commands while the module graph is still evaluating, so there is no
// later moment to install a host in.
//
// Both hosts are constructible without waiting for anything. The bridge host
// opens its connection in the background and queues calls made before it lands,
// which is why picking a host here does not mean blocking on one.
if (shouldUseBridge()) {
  const config = bridgeConfig();
  if (config == null) {
    // No token yet: put the connect form on screen and install a host that
    // never connects. Boot then stalls at its own top-level await rather than
    // failing somewhere that doesn't explain itself — and it stalls in the one
    // place already designed to wait, which keeps this file synchronous.
    promptForToken();
    setPlatform(createBridgePlatform(window.location.origin, null));
  } else {
    setPlatform(createBridgePlatform(config.url, config.token));
  }
} else {
  setPlatform(createTauriPlatform());
}

export * from "./capabilities";
export { platform, setPlatform } from "./registry";
export * from "./types";
