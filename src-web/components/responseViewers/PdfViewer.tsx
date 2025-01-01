import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import './PdfViewer.css';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import React, { useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import useSize from '@react-hook/size';

interface Props {
  bodyPath: string;
}

const options = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
};

export function PdfViewer({ bodyPath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number>();

  const [containerWidth] = useSize(containerRef.current);

  const onDocumentLoadSuccess = ({ numPages: nextNumPages }: PDFDocumentProxy): void => {
    setNumPages(nextNumPages);
  };

  const src = convertFileSrc(bodyPath);
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
