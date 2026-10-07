// The worker has its own globals, so it needs the polyfills before PDF.js evaluates
import "../../polyfills";
import "pdfjs-dist/build/pdf.worker.min.mjs";
