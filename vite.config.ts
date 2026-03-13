import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["npm/**", "crates/yaak-templates/pkg/**", "**/bindings/gen_*.ts"],
    options: {
      typeAware: true,
    },
    rules: {
      "typescript/no-explicit-any": "error",
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/flatpak/**"],
  },
});
