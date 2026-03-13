import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    ignorePatterns: ['npm/**', 'crates/yaak-templates/pkg/**'],
  },
  test: {
    exclude: ['**/node_modules/**', '**/flatpak/**'],
  },
});
