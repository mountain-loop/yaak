import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { build } from "vite";
import { expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const viewer = path.join(root, "apps/yaak-client/components/responseViewers/PdfViewer.tsx");

test.each(["http://tauri.localhost", "tauri://localhost"])(
  "PDF viewer configures a matching bundled worker before rendering on %s",
  async (origin) => {
    const result = await build({
      configFile: false,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      root,
      logLevel: "silent",
      resolve: {
        // Keep the real sizing hook without pulling unrelated UI/platform code into this fixture.
        alias: {
          "@yaakapp-internal/ui": path.join(root, "packages/ui/src/hooks/useContainerSize.ts"),
        },
      },
      plugins: [
        {
          name: "pdf-viewer-test-entry",
          resolveId(id) {
            if (id === "pdf-viewer-test") return id;
          },
          load(id) {
            if (id !== "pdf-viewer-test") return;
            return `
          import { PdfViewer } from ${JSON.stringify(viewer)};
          import { pdfjs } from 'react-pdf';
          globalThis.pdfViewerTest = { PdfViewer, workerSrc: pdfjs.GlobalWorkerOptions.workerSrc, version: pdfjs.version };
        `;
          },
        },
      ],
      build: {
        target: "esnext",
        modulePreload: false,
        cssCodeSplit: false,
        write: false,
        minify: true,
        rolldownOptions: {
          input: "pdf-viewer-test",
          output: { format: "es", codeSplitting: false },
        },
      },
    });
    if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one bundle");
    const entry = result.output.find((chunk) => chunk.type === "chunk" && chunk.isEntry);
    if (!entry || entry.type !== "chunk") throw new Error("Missing viewer entry");

    // Evaluate as a browser (no Node process), and inspect immediately, before promise callbacks.
    // This checks initialization timing and assets, not rendering or native asset protocols.
    const context = vm.createContext({
      URL,
      navigator: { userAgent: "" },
      DOMMatrix: class {},
      window: { requestAnimationFrame: () => {}, location: new URL(`${origin}/`) },
      document: {
        documentElement: { style: {} },
        createElement: () => ({ style: {} }),
        addEventListener: () => {},
      },
      console,
      self: { location: { href: `${origin}/index.html` } },
    });
    // Supply the module URL to the script VM without changing the emitted asset path.
    vm.runInContext(
      entry.code.replaceAll(
        "import.meta",
        `({ url: ${JSON.stringify(`${origin}/assets/entry.js`)} })`,
      ),
      context,
    );
    const { workerSrc, version } = context.pdfViewerTest as { workerSrc: string; version: string };
    expect(workerSrc).toContain("/assets/");
    const workerUrl = new URL(workerSrc);
    expect(workerUrl.protocol).toBe(new URL(origin).protocol);
    expect(workerUrl.host).toBe(new URL(origin).host);
    const worker = result.output.find((asset) => `/${asset.fileName}` === workerUrl.pathname);
    expect(worker?.type).toBe("asset");
    if (!worker || worker.type !== "asset")
      throw new Error("Worker URL missing from production assets");

    // Resolve from React-PDF itself so a second, mismatched PDF.js installation is caught.
    const require = createRequire(path.join(root, "apps/yaak-client/package.json"));
    const reactPdfRequire = createRequire(require.resolve("react-pdf"));
    const pdfjsDir = path.dirname(reactPdfRequire.resolve("pdfjs-dist/package.json"));
    const installed = JSON.parse(await readFile(path.join(pdfjsDir, "package.json"), "utf8"));
    expect(version).toBe(installed.version);
    expect(Buffer.from(worker.source)).toEqual(
      await readFile(path.join(pdfjsDir, "build/pdf.worker.min.mjs")),
    );
  },
  30_000,
);
