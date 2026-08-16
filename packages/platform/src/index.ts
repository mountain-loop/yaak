import { setPlatform } from "./registry";
import { createTauriPlatform } from "./tauri";

// The desktop entry. Installed unconditionally and synchronously — several
// modules call commands while the module graph is still evaluating, so there is
// no later moment to do this in.
//
// This line is the swap point, and a browser build swaps it by resolving the
// package to `index.web.ts` instead of this file. Because nothing else in the
// app imports a host directly, that is the whole change.
setPlatform(createTauriPlatform());

export * from "./capabilities";
export { platform, setPlatform } from "./registry";
export * from "./types";
