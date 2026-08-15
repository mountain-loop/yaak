import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "./PdfViewer.css";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import { useContainerSize } from "@yaakapp-internal/ui";
import { fireAndForget } from "../../lib/fireAndForget";

fireAndForget(
  import("react-pdf").then(({ pdfjs }) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }),
);

interface Props {
  /** A URL for the body the host already stored. */
  bodyUrl?: string;
  data?: Uint8Array;
}

const options = {
  cMapUrl: "/cmaps/",
  standardFontDataUrl: "/standard_fonts/",
};

export function PdfViewer({ bodyUrl, data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number>();

  const { width: containerWidth } = useContainerSize(containerRef);

  // During render, not in an effect: an effect leaves the first paint with no file, and
  // `Document` renders its "Failed to load PDF file" state for that frame before recovering
  const src = useMemo(() => {
    if (bodyUrl) {
      return bodyUrl;
    }
    if (data) {
      // Create a copy to avoid "Buffer is already detached" errors
      // This happens when the ArrayBuffer is transferred/detached elsewhere
      return { data: new Uint8Array(data) };
    }
    return undefined;
  }, [bodyUrl, data]);

  const onDocumentLoadSuccess = ({ numPages: nextNumPages }: PDFDocumentProxy): void => {
    setNumPages(nextNumPages);
  };

  // Nothing to show yet, rather than the failure state `Document` renders for an empty file
  if (src == null) {
    return null;
  }

  return (
    <div ref={containerRef} className="w-full h-full overflow-y-auto">
      <Document
        file={src}
        options={options}
        onLoadSuccess={onDocumentLoadSuccess}
        externalLinkTarget="_blank"
        externalLinkRel="noopener noreferrer"
      >
        {Array.from({ length: numPages ?? 0 }, (_, index) => (
          <Page
            className="mb-6 select-all"
            renderTextLayer
            renderAnnotationLayer
            key={`page_${index + 1}`}
            pageNumber={index + 1}
            width={containerWidth}
          />
        ))}
      </Document>
    </div>
  );
}
