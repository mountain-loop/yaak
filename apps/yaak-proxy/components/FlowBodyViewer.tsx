import { useQuery } from "@tanstack/react-query";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow, FlowBody } from "@yaakapp-internal/proxy-lib";
import {
  ACTIONS_BAR_CONTAINER,
  ActionsBar,
  Banner,
  BodyViewModeSwitch,
  Button,
  CsvViewer,
  HexdumpViewer,
  Icon,
  ImageViewer,
  LARGE_BODY_BYTES,
  languageFromContentType,
  LoadingIcon,
  MultipartViewer,
  type PrettyView,
  prettyViewFor,
  type ResponseViewMode,
  SvgViewer,
  TextViewer,
  WebPageViewer,
} from "@yaakapp-internal/ui";
import type { CodeEditorProps } from "@yaakapp-internal/ui/editor";
import classNames from "classnames";
import { useAtom } from "jotai";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bodyViewModeAtom } from "../lib/atoms";
import {
  bodyAsText,
  bodyImageType,
  filterText,
  findHeader,
  emptyBodyText,
  flowBodyQueryOptions,
  formatText,
  mimeEssence,
} from "../lib/body";
import { useSaveFlowBody } from "../lib/flowActions";

interface Props {
  flow: Flow;
  which: FlowBody;
  /** A URL-encoded body's fields, its formatted view, with the switch in the fields' own bar */
  form?: (actions: ReactNode) => ReactNode;
  /** Leaves saying the body was cut short to the tab, which says it its own way */
  hideCutNote?: boolean;
}

export function useFlowBody(flow: Flow, which: FlowBody, enabled = true) {
  return useQuery({ ...flowBodyQueryOptions(flow, which), enabled });
}

/** A mode chosen for one large body, which holds for it alone */
interface ChosenViewMode {
  key: string;
  mode: ResponseViewMode;
}

/** The mode a body shows in: the preference, except raw for a large one until chosen for it */
export function shownViewMode({
  key,
  large,
  preferred,
  chosen,
}: {
  key: string;
  large: boolean;
  preferred: ResponseViewMode;
  chosen: ChosenViewMode | null;
}): ResponseViewMode {
  if (chosen?.key === key) return chosen.mode;
  return large ? "raw" : preferred;
}

/**
 * Formatted or raw, as last chosen, except that a body big enough to slow the card opens raw,
 * and choosing for it holds for that body alone
 */
export function useBodyViewMode(
  key: string,
  large: boolean,
): [ResponseViewMode, (mode: ResponseViewMode) => void] {
  const [preferred, setPreferred] = useAtom(bodyViewModeAtom);
  const [chosen, setChosen] = useState<ChosenViewMode | null>(null);
  const mode = shownViewMode({ key, large, preferred, chosen });
  const setMode = useCallback(
    (next: ResponseViewMode) => {
      if (large) {
        setChosen({ key, mode: next });
      } else {
        setChosen(null);
        setPreferred(next);
      }
    },
    [key, large, setPreferred],
  );
  return [mode, setMode];
}

/**
 * The formatted view a body has, or null when it has only the one: parts for multipart, the
 * fields for a URL-encoded form, or else what the shared rule gives its text. Images and binary
 * bodies have only their one view.
 */
export function flowPrettyView({
  which,
  mime,
  text,
  binary,
  language,
  hasForm,
}: {
  which: FlowBody;
  mime: string;
  text: string | null;
  /** An image, or what failed to decode */
  binary: boolean;
  language: CodeEditorProps["language"] | null;
  hasForm: boolean;
}): PrettyView | null {
  if (binary) return null;
  if (mime.startsWith("multipart/")) return "parts";
  if (text == null) return null;
  if (hasForm && mime === "application/x-www-form-urlencoded") return "form";
  return prettyViewFor({ mimeType: mime, language, previewHtml: which === "response" });
}

export function FlowBodyViewer({ flow, which, form, hideCutNote = false }: Props) {
  const body = useFlowBody(flow, which);
  const [mode, setMode] = useBodyViewMode(
    `${flow.id}.${which}`,
    (body.data?.bytes.length ?? 0) > LARGE_BODY_BYTES,
  );

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

  const { bytes, truncated, storedSize, decodeError, note } = body.data;
  if (bytes.length === 0 && decodeError == null) {
    return <EmptyState>{emptyBodyText(which, note)}</EmptyState>;
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
  const language = text == null ? null : languageFromContentType(contentType, text);
  const prettyView = flowPrettyView({
    which,
    mime,
    text,
    binary: decodeError != null || imageType != null,
    language,
    hasForm: form != null,
  });
  // The one view a body without a formatted one has is its raw one
  const pretty = prettyView != null && mode === "pretty";
  const modeSwitch =
    prettyView == null ? null : (
      <BodyViewModeSwitch pretty={prettyView} value={mode} onChange={setMode} />
    );

  let viewer: ReactNode;
  let ownsBar = false;
  if (decodeError != null) {
    // What failed to decode is as it was on the wire, compressed, so never text.
    viewer = <BinaryBody flow={flow} which={which} bytes={bytes} />;
  } else if (prettyView === "parts" && pretty) {
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
  } else if (prettyView === "form" && pretty && form != null) {
    ownsBar = true;
    viewer = form(modeSwitch);
  } else if (prettyView === "table" && pretty) {
    viewer = <CsvViewer text={text} className="pb-2" />;
  } else if (prettyView === "preview" && pretty) {
    viewer = mime.startsWith("image/svg") ? (
      <SvgViewer text={text} />
    ) : (
      <WebPageViewer html={text} baseUrl={flow.url} />
    );
  } else {
    ownsBar = true;
    viewer = (
      <FlowTextViewer
        flow={flow}
        which={which}
        text={text}
        language={language}
        pretty={pretty}
        modeSwitch={modeSwitch}
      />
    );
  }

  // The text viewer and the form draw the switch in their own bar, beside their own actions; the
  // rest get a bar here. Each fills the tab content, so every bar has the same inset.
  if (modeSwitch != null && !ownsBar) {
    viewer = (
      <div className={classNames(ACTIONS_BAR_CONTAINER, "h-full w-full")}>
        {viewer}
        <ActionsBar>{modeSwitch}</ActionsBar>
      </div>
    );
  }

  if ((!truncated || hideCutNote) && decodeError == null) return viewer;

  return (
    <div className="h-full grid grid-rows-[auto_auto_minmax(0,1fr)]">
      {decodeError != null && (
        <Banner color="danger" className="text-sm mb-2">
          {decodeError}. Showing the body as it was on the wire.
        </Banner>
      )}
      {truncated && !hideCutNote && (
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
  modeSwitch,
}: {
  flow: Flow;
  which: FlowBody;
  text: string;
  language: CodeEditorProps["language"];
  pretty: boolean;
  /** Formatted or raw, in the viewer's bar after its filter; null for a body with one view */
  modeSwitch: ReactNode;
}) {
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
      ownActionsBar
      pinnedActions={modeSwitch}
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
