import { useQuery } from "@tanstack/react-query";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow, FlowBody } from "@yaakapp-internal/proxy-lib";
import {
  Banner,
  CsvViewer,
  ImageViewer,
  languageFromContentType,
  LoadingIcon,
  MultipartViewer,
  SvgViewer,
  TextViewer,
  WebPageViewer,
} from "@yaakapp-internal/ui";
import type { CodeEditorProps } from "@yaakapp-internal/ui/editor";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  base64ToBytes,
  bytesToText,
  filterText,
  findHeader,
  formatText,
  mimeEssence,
} from "../lib/body";
import { rpc } from "../lib/rpc";

interface Props {
  flow: Flow;
  which: FlowBody;
  pretty: boolean;
}

export function useFlowBody(flow: Flow, which: FlowBody, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["get_flow_body", flow.id, which, flow.updatedAt],
    queryFn: async () => {
      const res = await rpc("get_flow_body", { flowId: flow.id, which });
      return {
        bytes: base64ToBytes(res.data),
        truncated: res.truncated,
        storedSize: res.storedSize,
      };
    },
  });
}

export function FlowBodyViewer({ flow, which, pretty }: Props) {
  const body = useFlowBody(flow, which);

  if (body.isPending) {
    return (
      <EmptyState>
        <LoadingIcon />
      </EmptyState>
    );
  }
  if (body.error) {
    return <Banner color="danger">{body.error.message}</Banner>;
  }

  const { bytes, truncated, storedSize } = body.data;
  if (bytes.length === 0) {
    return <EmptyState>{which === "request" ? "No request body" : "Empty"}</EmptyState>;
  }

  const headers = which === "request" ? flow.requestHeaders : flow.responseHeaders;
  const contentType = findHeader(headers, "content-type");
  const mime = mimeEssence(contentType) ?? "";
  const wireSize = which === "request" ? flow.requestSize : flow.responseSize;
  const wireTruncated = which === "request" ? flow.requestTruncated : flow.responseTruncated;

  let viewer: ReactNode;
  if (mime.startsWith("image/svg")) {
    viewer = <SvgViewer text={bytesToText(bytes, truncated) ?? ""} />;
  } else if (mime.startsWith("image/")) {
    viewer = <ImageBody bytes={bytes} mime={mime} />;
  } else if (mime.startsWith("multipart/") && pretty) {
    const boundary = contentType?.match(/;\s*boundary="?([^";]+)"?/i)?.[1] ?? "unknown";
    viewer = (
      <MultipartViewer
        data={bytes}
        boundary={boundary}
        idPrefix={`${flow.id}.${which}`}
        textViewerProps={{ formatText }}
      />
    );
  } else if (/csv|tab-separated/.test(mime) && pretty) {
    viewer = <CsvViewer text={bytesToText(bytes, truncated)} className="pb-2" />;
  } else {
    const text = bytesToText(bytes, truncated);
    const language = languageFromContentType(contentType, text);
    if (text == null) {
      viewer = <EmptyState>Binary body, {formatSize(bytes.length)}</EmptyState>;
    } else if (language === "html" && pretty && which === "response") {
      viewer = <WebPageViewer html={text} baseUrl={flow.url} />;
    } else {
      viewer = (
        <FlowTextViewer flow={flow} which={which} text={text} language={language} pretty={pretty} />
      );
    }
  }

  if (!truncated) return viewer;

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)] gap-2">
      <Banner color="notice" className="text-sm">
        {wireTruncated
          ? `Showing the first ${formatSize(storedSize)} of ${formatSize(wireSize)}, the capture limit. The app received all of it.`
          : `Showing the first ${formatSize(bytes.length)} of the decoded body, the capture limit. The app received all of it.`}
      </Banner>
      <div className="min-h-0">{viewer}</div>
    </div>
  );
}

/** A text body, filtered with the syntax for the language detected from it, not just its header */
function FlowTextViewer({
  flow,
  which,
  text,
  language,
  pretty,
}: Props & { text: string; language: CodeEditorProps["language"] }) {
  const runFilter = useCallback(
    (expression: string) => filterText(flow.id, which, expression, language),
    [flow.id, which, language],
  );

  return (
    <TextViewer
      text={text}
      language={language}
      stateKey={`flow.${flow.id}.${which}`}
      pretty={pretty}
      className="-mr-2 bg-surface"
      formatText={formatText}
      filterText={runFilter}
    />
  );
}

function ImageBody({ bytes, mime }: { bytes: Uint8Array<ArrayBuffer>; mime: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    createImageBitmap(new Blob([bytes], { type: mime })).then(
      (bitmap) => {
        if (!cancelled) setSize({ width: bitmap.width, height: bitmap.height });
        bitmap.close();
      },
      () => {
        if (!cancelled) setSize(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bytes, mime]);

  return (
    <div className="h-full grid grid-rows-[minmax(0,1fr)_auto] gap-2 pb-2">
      <div className="min-h-0 grid place-items-center rounded-lg border border-border-subtle overflow-hidden p-3 bg-[repeating-conic-gradient(var(--color-surface-highlight)_0_25%,transparent_0_50%)] bg-size-[16px_16px]">
        <ImageViewer data={bytes.buffer} mimeType={mime} className="object-contain" />
      </div>
      <div className="text-center text-xs text-text-subtle font-mono">
        {size != null && `${size.width} × ${size.height} • `}
        {mime} • {formatSize(bytes.length)}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full grid place-items-center text-center text-text-subtlest text-sm px-6">
      <div>{children}</div>
    </div>
  );
}
