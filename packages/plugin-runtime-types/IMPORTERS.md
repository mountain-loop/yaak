# Importers

Implement **`onImportSource(ctx, { source })`**. The source is one of two things:

- `{ type: "text", name, text }`: a single UTF-8 document, or pasted text (named `input`).
- `{ type: "directory", files }`: a directory or a ZIP archive, read as one file tree.

Return `null` or `undefined` when the source isn't your format. Only one importer's result is used per source.

```ts
import type { PluginDefinition } from "@yaakapp/api";

export const plugin: PluginDefinition = {
  importer: {
    name: "Example",
    async onImportSource(ctx, { source }) {
      if (source.type === "text") return convertDocument(source.text);
      for (const entry of await source.files.readDir()) {
        if (entry.name === "example.json") {
          return convertDocument(await source.files.readTextFile(entry.path));
        }
      }
      return null;
    },
  },
};
```

The older `onImport(ctx, { text })` hook still works but is deprecated. It only receives single text documents and is ignored when `onImportSource` is defined.

## The file tree

- `files.kind` is `"directory"` or `"zip"`; `files.name` is the selected basename.
- `readDir(path = "")` lists immediate children. `readFile(path)` returns bytes. `readTextFile(path)` decodes UTF-8 strictly.
- Paths use `/` and are relative to the root. Absolute paths, `..`, and backslashes are rejected. Symbolic links are skipped in listings and rejected on read. Nothing is extracted to disk.
- ZIPs are detected by signature, not extension. A ZIP made by compressing a folder is rooted at that folder, so plugins see the same tree as for the directory. Directory reads are not a snapshot: a symlink swapped in under a validated path can redirect a read outside the root, so treat directory imports as trusted input.
- Limits: 64 MiB per source file or download, 32 MiB per file read, 10,000 entries, 256 MiB declared ZIP expansion. Encrypted ZIPs are unsupported.
- The tree is read-only and only valid until the hook settles.

Plugins run with the normal Node.js permissions of the plugin runtime; the tree scopes convenience, not security.
