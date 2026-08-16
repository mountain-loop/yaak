import { setPlatform } from "./registry";
import { createWebPlatform } from "./web";

/**
 * The package entry for browser builds, selected by aliasing
 * `@yaakapp-internal/platform` to this file (see `YAAK_TARGET=web` in the
 * client's vite.config.ts).
 *
 * A separate entry rather than a branch inside `index.ts`, because a branch
 * would still leave `import "@tauri-apps/api"` in the module graph: the folded
 * `if` disappears, but the imports it guarded do not, and those modules cannot
 * be proven side-effect free. Splitting the entry means a web build never
 * mentions Tauri at all — and it keeps `index.ts` exactly as the desktop has
 * always had it.
 *
 * Like `index.ts`, this must install the host eagerly and synchronously:
 * boot-time modules call commands while the module graph is still evaluating.
 */
setPlatform(createWebPlatform());

export * from "./capabilities";
export { platform, setPlatform } from "./registry";
export * from "./types";
