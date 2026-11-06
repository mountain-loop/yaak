// @ts-ignore
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, normalizePath } from "vite-plus";
import { viteStaticCopy } from "vite-plugin-static-copy";
import wasm from "vite-plugin-wasm";

const require = createRequire(import.meta.url);
const cMapsDir = normalizePath(
  path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "cmaps"),
);
const standardFontsDir = normalizePath(
  path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts"),
);

// The app's own icons, served as the page icon rather than copied into the client:
// the bundled app and the tab should not be able to disagree about what Yaak looks like.
const iconsDir = normalizePath(
  path.join(import.meta.dirname, "../../crates-tauri/yaak-app-client/icons/release"),
);

/**
 * Which host the platform package installs. `web` builds Yaak to run in a plain
 * browser tab, with its own IndexedDB store instead of the Rust engine; anything
 * else builds the desktop app exactly as before.
 */
const yaakTarget = process.env.YAAK_TARGET === "web" ? "web" : "desktop";

const webUrl = "https://web.yaak.app";
const webDir = normalizePath(path.join(import.meta.dirname, "web"));

/** Link previews for the hosted web app. Meaningless inside the desktop window. */
function webHead() {
  return {
    name: "web-head",
    transformIndexHtml() {
      const title = "Yaak in your browser";
      const description = "No download, no setup. Open a tab and send your first request.";
      return [
        { tag: "meta", attrs: { name: "description", content: description } },
        { tag: "meta", attrs: { property: "og:type", content: "website" } },
        { tag: "meta", attrs: { property: "og:url", content: webUrl } },
        { tag: "meta", attrs: { property: "og:title", content: title } },
        { tag: "meta", attrs: { property: "og:description", content: description } },
        { tag: "meta", attrs: { property: "og:image", content: `${webUrl}/og.png` } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:site", content: "@yaakapp" } },
        { tag: "meta", attrs: { name: "twitter:title", content: title } },
        { tag: "meta", attrs: { name: "twitter:description", content: description } },
        { tag: "meta", attrs: { name: "twitter:image", content: `${webUrl}/og.png` } },
      ];
    },
  };
}

/**
 * Where `yaak-web` is listening, taken from the same variables that put it there.
 *
 * `HOST` is an instruction about what the server accepts rather than an address to
 * dial, so a wildcard becomes loopback: the dev server and the send server share a
 * machine.
 */
function sendServerUrl(): string {
  const host = process.env.HOST?.trim();
  const port = process.env.PORT?.trim() || "9227";
  const wildcard = !host || host === "0.0.0.0" || host === "::" || host === "[::]";
  return `http://${wildcard ? "127.0.0.1" : host}:${port}`;
}

/**
 * Fails the build when a copied asset is not where the app fetches it from.
 *
 * `PdfViewer` and the page head address these by URL, but nothing ties those
 * URLs to the copy targets below, and a target that mirrors its source path
 * instead of landing at the root still builds cleanly — the miss only shows up
 * as a 404 once the app runs.
 */
function verifyServedAssets(expected: string[]) {
  let outDir = "";
  return {
    name: "verify-served-assets",
    apply: "build" as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    // After viteStaticCopy, which writes on `writeBundle`.
    closeBundle() {
      const missing = expected.filter((asset) => {
        const full = path.join(outDir, asset);
        if (!fs.existsSync(full)) return true;
        const stat = fs.statSync(full);
        return stat.isDirectory() && fs.readdirSync(full).length === 0;
      });
      if (missing.length > 0) {
        throw new Error(
          `Copied assets missing from ${outDir}: ${missing.join(", ")}. ` +
            `Every viteStaticCopy target needs to strip its base path, or it lands ` +
            `under a copy of the directories it came from instead.`,
        );
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(async () => {
  return {
    resolve: {
      alias:
        yaakTarget === "web"
          ? {
              // Resolve the platform package to its browser entry, so a web
              // build never pulls `@tauri-apps/*` into the graph at all. A
              // build-time branch inside the package would not manage that:
              // the dead branch folds away, but the imports it guarded stay.
              "@yaakapp-internal/platform": path.resolve(
                import.meta.dirname,
                "../../packages/platform/src/index.web.ts",
              ),
            }
          : {},
    },
    // The browser host runs the model layer in a worker; that bundle needs the
    // same wasm handling as the main one. Top-level await needs no transform
    // because the build targets esnext.
    worker: {
      format: "es" as const,
      plugins: () => [wasm()],
    },
    plugins: [
      wasm(),
      tanstackRouter({
        target: "react",
        routesDirectory: "./routes",
        generatedRouteTree: "./routeTree.gen.ts",
        autoCodeSplitting: true,
      }),
      react(),
      viteStaticCopy({
        // v4 matches only files and always mirrors the source tree into the
        // output, so every target here needs stripBase to land where it is
        // actually served from — without it these end up under a copy of the
        // path they came from, and nothing fails until the request 404s.
        targets: [
          { src: `${cMapsDir}/*`, dest: "cmaps", rename: { stripBase: true } },
          {
            src: `${standardFontsDir}/*`,
            dest: "standard_fonts",
            rename: { stripBase: true },
          },
          // `/favicon.ico` is requested by browsers whether or not anything links to it,
          // so it is served under that name to keep a 404 out of every console.
          {
            src: `${iconsDir}/icon.ico`,
            dest: "",
            rename: { name: "favicon.ico", stripBase: true },
          },
          {
            src: `${iconsDir}/128x128.png`,
            dest: "",
            rename: { name: "icon-128.png", stripBase: true },
          },
          ...(yaakTarget === "web"
            ? [{ src: `${webDir}/og.png`, dest: "", rename: { stripBase: true } }]
            : []),
        ],
      }),
      ...(yaakTarget === "web" ? [webHead()] : []),
      verifyServedAssets([
        "cmaps",
        "standard_fonts",
        "favicon.ico",
        "icon-128.png",
        ...(yaakTarget === "web" ? ["og.png"] : []),
      ]),
    ],
    build: {
      target: "esnext",
      sourcemap: true,
      outDir: "../../dist/apps/yaak-client",
      emptyOutDir: true,
      rolldownOptions: {
        output: {
          // Make chunk names readable
          chunkFileNames: "assets/chunk-[name]-[hash].js",
          entryFileNames: "assets/entry-[name]-[hash].js",
          assetFileNames: "assets/asset-[name]-[hash][extname]",
          // Vite-Plus/Rolldown 0.1.20 can emit a stale style-mod export when
          // top-level var rewriting combines with OXC minification.
          topLevelVar: false,
        },
      },
    },
    clearScreen: false,
    server: {
      // `HOST` names the interface, as it does most places: unset leaves Vite on
      // loopback, `0.0.0.0` exposes it for reaching the dev server from another
      // device.
      host: process.env.HOST,
      // Vite refuses a `Host` it does not recognise, which stops a page on a name the
      // attacker controls from rebinding that name here and driving `/v1` as its own
      // origin. Addresses are allowed already; only names need listing, so reaching
      // this as `dev-box.example` means naming it. Deliberately not widened to "any
      // host when exposed": the proxy below leads to an unauthenticated sender.
      allowedHosts: process.env.ALLOWED_HOSTS?.split(",")
        .map((h) => h.trim())
        .filter(Boolean),
      port: parseInt(process.env.YAAK_CLIENT_DEV_PORT ?? process.env.YAAK_DEV_PORT ?? "1420", 10),
      strictPort: true,
      // A web dev server is one origin, the way the built app is: `/v1` is passed
      // through to `yaak-web` rather than the tab being told to call it directly.
      // That is one address to open instead of two, no CORS in the loop, and a
      // dev build that sends exactly the way a production build does.
      proxy:
        yaakTarget === "web"
          ? { "/v1": { target: sendServerUrl(), changeOrigin: true } }
          : undefined,
    },
    envPrefix: ["VITE_", "TAURI_"],
  };
});
