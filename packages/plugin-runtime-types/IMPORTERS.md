# File-aware importers

Use **`onImportFiles(ctx, { files })`** for new importers. It handles single files, pasted text, ZIPs, and directories through the same file-tree API. Scan the tree for recognized files instead of assuming its first entry is the entire collection.

The existing `onImport(ctx, { text })` hook remains supported but is deprecated:

- When `onImportFiles` exists, it handles every input, including text. `onImport` is ignored, even if the file hook returns `null` or `undefined`.
- Plugins with only `onImport` continue to receive single UTF-8 files and pasted text. They are not called for directories, ZIPs, or binary input.
- The runtime logs a migration warning once per loaded importer when its deprecated hook is first called. It does not show a user-facing alert.
- Returning `null` or `undefined` means the plugin did not recognize the input. Only one hook runs per plugin per input.

A new importer looks like:

```ts
import type { PluginDefinition } from "@yaakapp/api";

export const plugin: PluginDefinition = {
  importer: {
    name: "Example",
    async onImportFiles(ctx, { files }) {
      // files.kind: 'file' | 'zip' | 'directory'
      // files.name: selected file or directory basename
      async function walk(directory = "") {
        for (const entry of await files.readDir(directory)) {
          // entry: { name, path, type: 'file' | 'directory' }
          if (entry.type === "directory") {
            await walk(entry.path);
          } else if (entry.name.endsWith(".json")) {
            const document = JSON.parse(await files.readTextFile(entry.path));
            // Convert recognized documents to PartialImportResources.
          }
        }
      }
      await walk();
      return null; // This importer did not recognize the source.
    },
  },
};
```

- `readDir(path = '')` lists immediate children in path order. The root is `''`.
- `readFile(path)` returns a `Uint8Array`, preserving arbitrary binary data.
- `readTextFile(path)` decodes UTF-8 and throws for invalid text.
- Paths use `/` and are relative to the source. Absolute paths, `..`, backslashes, and symbolic links are rejected. No archive files are extracted to disk.
- A single file is a one-entry tree. Pasted text is exposed as a file named `input`.
- The API is read-only and valid only until `onImportFiles` resolves or rejects. Do not retain it for later use. Import errors include the plugin's error message when no importer succeeds.
- Directory contents are read on demand. ZIP metadata is indexed once per invocation; entries are decompressed only when read. Reads are not an atomic filesystem snapshot: changing a directory during import can change its results.
- Limits: 64 MiB source file/download, 32 MiB per file read, 10,000 entries per directory listing/ZIP, and 256 MiB total declared ZIP expansion. Encrypted ZIPs are unsupported. Large or invalid inputs fail explicitly.

The desktop picker accepts one file or folder, including a dropped path. Multiple-file selection is not yet supported. The CLI accepts a file, ZIP, or directory with `yaak import <path>`. URL imports support text and ZIP downloads. The same preview, destination, and linked-reimport logic runs after conversion.

This API scopes filesystem access for convenience; plugins themselves still run with the existing Node.js runtime permissions. It is not a plugin sandbox.
