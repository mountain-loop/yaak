import { setPlatform } from "./registry";
import { createTauriPlatform } from "./tauri";

// Desktop is the only host today, so it is installed unconditionally and
// synchronously — several modules call commands while the module graph is still
// evaluating, so there is no later moment to do this in.
//
// This line is the swap point. A browser build selects its own host here, and
// because nothing else in the app imports a host directly, that is the whole
// change.
setPlatform(createTauriPlatform());

export * from "./capabilities";
export { platform, setPlatform } from "./registry";
export * from "./types";
