import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  // Generated output, reformatted only to be undone by the next regen. Read by every formatter
  // entry point, including the `staged` task above.
  fmt: {
    ignorePatterns: [
      "**/bindings/**",
      "**/routeTree.gen.ts",
      "crates/yaak-templates/pkg/**",
      "crates/yaak-wasm/pkg/**",
    ],
  },
  lint: {
    ignorePatterns: [
      "npm/**",
      "crates/yaak-templates/pkg/**",
      "crates/yaak-wasm/pkg/**",
      "**/bindings/gen_*.ts",
    ],
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
