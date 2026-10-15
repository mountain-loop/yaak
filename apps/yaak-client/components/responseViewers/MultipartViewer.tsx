import {
  LoadingIcon,
  MultipartViewer as BaseMultipartViewer,
  type MultipartViewerProps,
} from "@yaakapp-internal/ui";
import { lazy, Suspense } from "react";
import { renderEditor } from "../core/Editor/renderEditor";
import { ErrorBoundary } from "../ErrorBoundary";
import { formatText, textViewerExtensions } from "./TextViewer";

const PdfViewer = lazy(() => import("./PdfViewer").then((m) => ({ default: m.PdfViewer })));

const textViewerProps = { extensions: textViewerExtensions, formatText, renderEditor };

export function MultipartViewer(
  props: Omit<MultipartViewerProps, "renderPdf" | "textViewerProps" | "ErrorBoundary">,
) {
  return (
    <BaseMultipartViewer
      {...props}
      renderPdf={renderPdf}
      textViewerProps={textViewerProps}
      ErrorBoundary={ErrorBoundary}
    />
  );
}

function renderPdf(data: Uint8Array) {
  return (
    <Suspense fallback={<LoadingIcon />}>
      <PdfViewer data={data} />
    </Suspense>
  );
}
