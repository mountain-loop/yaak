import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    ignorePatterns: ["npm/**", "crates/yaak-templates/pkg/**", "crates/yaak-wasm/pkg/**", "**/bindings/gen_*.ts"],
    options: {
      typeAware: true,
    },
    rules: {
      "typescript/no-explicit-any": "error",
    },
  },
  test: {
    // Nested git worktrees live under .claude, and their tests are not this checkout's
    exclude: ["**/node_modules/**", "**/flatpak/**", "**/.claude/**"],
  },
});
