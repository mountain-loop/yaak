// @ts-ignore
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, normalizePath } from "vite-plus";
import { viteStaticCopy } from "vite-plugin-static-copy";
import svgr from "vite-plugin-svgr";

const require = createRequire(import.meta.url);
const cMapsDir = normalizePath(
  path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "cmaps"),
);
const standardFontsDir = normalizePath(
  path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts"),
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "./routes",
      generatedRouteTree: "./routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    svgr(),
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    viteStaticCopy({
      targets: [
        { src: cMapsDir, dest: "" },
        { src: standardFontsDir, dest: "" },
      ],
    }),
  ],
  build: {
    sourcemap: true,
    outDir: "../dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Make chunk names readable
        chunkFileNames: "assets/chunk-[name]-[hash].js",
        entryFileNames: "assets/entry-[name]-[hash].js",
        assetFileNames: "assets/asset-[name]-[hash][extname]",
      },
    },
  },
  clearScreen: false,
  server: {
    port: parseInt(process.env.YAAK_DEV_PORT ?? "1420", 10),
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
