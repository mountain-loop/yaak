import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
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
