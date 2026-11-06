import { useQuery } from "@tanstack/react-query";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow, FlowBody } from "@yaakapp-internal/proxy-lib";
import {
  Banner,
  Button,
  CsvViewer,
  HexdumpViewer,
  Icon,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bodyAsText,
  bodyImageType,
  filterText,
  findHeader,
  flowBodyQueryOptions,
  formatText,
  mimeEssence,
} from "../lib/body";
import { useSaveFlowBody } from "../lib/flowActions";

interface Props {
  flow: Flow;
  which: FlowBody;
  pretty: boolean;
}

export function useFlowBody(flow: Flow, which: FlowBody, enabled = true) {
  return useQuery({ ...flowBodyQueryOptions(flow, which), enabled });
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

  const { bytes, truncated, storedSize, decodeError } = body.data;
  if (bytes.length === 0 && decodeError == null) {
    return <EmptyState>{which === "request" ? "No request body" : "Empty"}</EmptyState>;
  }

  const headers = which === "request" ? flow.requestHeaders : flow.responseHeaders;
  const contentType = findHeader(headers, "content-type");
  const mime = mimeEssence(contentType) ?? "";
  const wireSize = which === "request" ? flow.requestSize : flow.responseSize;
  const wireTruncated = which === "request" ? flow.requestTruncated : flow.responseTruncated;
  // An image by its bytes or type, else text whatever the content type says, so a page sent with
  // an odd one still reads: `viewerText`'s rule.
  const imageType = decodeError == null ? bodyImageType(bytes, truncated, contentType) : null;
  const text =
    decodeError == null && imageType == null ? bodyAsText(bytes, truncated, contentType) : null;

  let viewer: ReactNode;
  if (decodeError != null) {
    // What failed to decode is as it was on the wire, compressed, so never text.
    viewer = <BinaryBody flow={flow} which={which} bytes={bytes} />;
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
  } else if (imageType != null) {
    viewer = <ImageBody bytes={bytes} mime={imageType} />;
  } else if (text == null) {
    viewer = <BinaryBody flow={flow} which={which} bytes={bytes} />;
  } else if (mime.startsWith("image/svg")) {
    viewer = <SvgViewer text={text} />;
  } else if (/csv|tab-separated/.test(mime) && pretty) {
    viewer = <CsvViewer text={text} className="pb-2" />;
  } else {
    const language = languageFromContentType(contentType, text);
    if (language === "html" && pretty && which === "response") {
      viewer = <WebPageViewer html={text} baseUrl={flow.url} />;
    } else {
      viewer = (
        <FlowTextViewer flow={flow} which={which} text={text} language={language} pretty={pretty} />
      );
    }
  }

  if (!truncated && decodeError == null) return viewer;

  return (
    <div className="h-full grid grid-rows-[auto_auto_minmax(0,1fr)]">
      {decodeError != null && (
        <Banner color="danger" className="text-sm mb-2">
          {decodeError}. Showing the body as it was on the wire.
        </Banner>
      )}
      {truncated && (
        <Banner color="notice" className="text-sm mb-2">
          {wireTruncated || decodeError != null
            ? `Showing the first ${formatSize(storedSize)} of ${formatSize(wireSize)}, the capture limit. The app received all of it.`
            : `Showing the first ${formatSize(bytes.length)} of the decoded body, the capture limit. The app received all of it.`}
        </Banner>
      )}
      <div className="min-h-0 row-start-3">{viewer}</div>
    </div>
  );
}

/** Bytes shown in the hexdump; the rest are in the saved file */
const HEXDUMP_LIMIT = 256 * 1024;

/** A body that isn't text: a hexdump, and a way to save it */
function BinaryBody({
  flow,
  which,
  bytes,
}: {
  flow: Flow;
  which: FlowBody;
  bytes: Uint8Array<ArrayBuffer>;
}) {
  const saveBody = useSaveFlowBody();
  const shown = useMemo(() => bytes.subarray(0, HEXDUMP_LIMIT), [bytes]);

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)] gap-1">
      <div className="flex items-center justify-between gap-2 text-sm text-text-subtle">
        <span>
          Binary body, {formatSize(bytes.length)}
          {shown.length < bytes.length && `, first ${formatSize(shown.length)} shown`}
        </span>
        <Button
          size="2xs"
          variant="border"
          leftSlot={<Icon icon="download" size="xs" />}
          onClick={() => saveBody(flow, which)}
        >
          Save to File
        </Button>
      </div>
      <HexdumpViewer data={shown} className="-mr-2 bg-surface" />
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
