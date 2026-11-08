import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // The search box's query language is a WebAssembly package
  plugins: [wasm(), react()],
  build: {
    // Top-level await, which the WebAssembly package loads with
    target: "esnext",
    outDir: "../../dist/apps/yaak-proxy",
    emptyOutDir: true,
  },
  clearScreen: false,
  server: {
    port: parseInt(process.env.YAAK_PROXY_DEV_PORT ?? "2420", 10),
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
