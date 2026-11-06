import { platform } from "@yaakapp-internal/platform";
import {
  Banner,
  type EditorHost,
  EditorHostProvider,
  EmptyStateText,
  type HostBodyViewerArgs,
  type HttpBodyLoader,
  LoadingIcon,
  type StoredValue,
  type StoredValueNamespace,
} from "@yaakapp-internal/ui";
import { lazy, type ReactNode, Suspense } from "react";
import { useKeyValue } from "../hooks/useKeyValue";
import { copyToClipboard } from "../lib/copy";
import { showDialog } from "../lib/dialog";
import { showPrompt } from "../lib/prompt";
import { useDetailsBannerStoredValue } from "./core/DetailsBanner";
import { Editor } from "./core/Editor/LazyEditor";
import { Input } from "./core/Input";
import { ErrorBoundary } from "./ErrorBoundary";
import { MultipartViewer } from "./responseViewers/MultipartViewer";
import { TextViewer } from "./responseViewers/TextViewer";
import { SelectFile } from "./SelectFile";

const PdfViewer = lazy(() =>
  import("./responseViewers/PdfViewer").then((m) => ({ default: m.PdfViewer })),
);

function useClientStoredValue<T extends StoredValue>(
  key: string | string[] | null,
  fallback: T,
  namespace: StoredValueNamespace = "global",
) {
  // A null key is never written by the shared components, so any stable key will do
  const { value, set } = useKeyValue<T>({ namespace, key: key ?? ["tabs", "default"], fallback });
  return [value ?? fallback, set] as const;
}

function renderBodyViewer({ source, mimeType, body, complete }: HostBodyViewerArgs) {
  if (!mimeType?.match(/pdf/i)) return null;
  return source === "response" ? (
    <PdfResponseBody body={body} complete={complete} />
  ) : (
    <PdfRequestBody body={body} />
  );
}

/** Waits for the whole response, then loads the PDF from its file */
function PdfResponseBody({ body, complete }: { body: HttpBodyLoader; complete: boolean }) {
  const bodyUrl = body.useUrl(complete);

  if (!complete || bodyUrl.isLoading) {
    return (
      <EmptyStateText>
        <LoadingIcon />
      </EmptyStateText>
    );
  }
  if (bodyUrl.error) {
    return <Banner color="danger">{String(bodyUrl.error)}</Banner>;
  }
  if (bodyUrl.data == null) {
    return <div>Empty response body</div>;
  }
  return <PdfViewer bodyUrl={bodyUrl.data} />;
}

function PdfRequestBody({ body }: { body: HttpBodyLoader }) {
  const bytes = body.useBytes();
  if (bytes.data == null) return null;
  return (
    <Suspense fallback={<LoadingIcon />}>
      <PdfViewer data={bytes.data} />
    </Suspense>
  );
}

const clientEditorHost: EditorHost = {
  Editor,
  Input,
  SelectFile,
  showDialog,
  showPrompt,
  basename: (path) => platform.files.basename(path),
  useStoredValue: useClientStoredValue,
  useDetailsBannerStoredValue,
  ErrorBoundary,
  TextViewer,
  MultipartViewer,
  renderBodyViewer,
  openUrl: (url) => platform.openUrl(url),
  copy: (text) => copyToClipboard(text, { disableToast: true }),
};

/** Gives the shared editing components the client's templated editor, dialogs and storage */
export function ClientEditorHost({ children }: { children: ReactNode }) {
  return <EditorHostProvider value={clientEditorHost}>{children}</EditorHostProvider>;
}
