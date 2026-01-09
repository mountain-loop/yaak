import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import './PdfViewer.css';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { useContainerSize } from '../../hooks/useContainerQuery';

import('react-pdf').then(({ pdfjs }) => {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
});

interface Props {
  bodyPath?: string;
  data?: Uint8Array;
}

const options = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
};

export function PdfViewer({ bodyPath, data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number>();
  const [src, setSrc] = useState<string | { data: Uint8Array }>();

  const { width: containerWidth } = useContainerSize(containerRef);

  useEffect(() => {
    if (bodyPath) {
      setSrc(convertFileSrc(bodyPath));
    } else if (data) {
      // Create a copy to avoid "Buffer is already detached" errors
      // This happens when the ArrayBuffer is transferred/detached elsewhere
      const dataCopy = new Uint8Array(data);
      setSrc({ data: dataCopy });
    } else {
      setSrc(undefined);
    }
  }, [bodyPath, data]);

  const onDocumentLoadSuccess = ({ numPages: nextNumPages }: PDFDocumentProxy): void => {
    setNumPages(nextNumPages);
  };
  return (
    <div ref={containerRef} className="w-full h-full overflow-y-auto">
      <Document
        file={src}
        options={options}
        onLoadSuccess={onDocumentLoadSuccess}
        externalLinkTarget="_blank"
        externalLinkRel="noopener noreferrer"
      >
        {Array.from(new Array(numPages), (_, index) => (
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
