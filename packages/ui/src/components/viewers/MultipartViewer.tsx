import type { ReactNode } from "react";
import { useMemo } from "react";
import { languageFromContentType } from "../../lib/contentType";
import {
  boundaryFromContentType,
  headerValue,
  type HttpMessage,
  isProbablyBinary,
  type MultipartParseResult,
  type MultipartPart,
  parseHttpMessage,
  parseMultipart,
} from "../../lib/multipart";
import { Banner } from "../Banner";
import { HeadersTable } from "../HeadersTable";
import { Icon } from "../Icon";
import { HttpStatusTagRaw } from "../tags/HttpStatusTag";
import { TabContent, type TabContentProps, Tabs } from "../tabs/Tabs";
import { AudioViewer } from "./AudioViewer";
import { CsvViewer } from "./CsvViewer";
import { HexdumpViewer } from "./HexdumpViewer";
import { ImageViewer } from "./ImageViewer";
import { SvgViewer } from "./SvgViewer";
import { TextViewer, type TextViewerProps } from "./TextViewer";
import { VideoViewer } from "./VideoViewer";
import { WebPageViewer } from "./WebPageViewer";

export interface MultipartViewerProps {
  data: Uint8Array;
  /** The boundary, bare or as cut from a `Content-Type` header (quotes and later parameters are dropped) */
  boundary: string;
  idPrefix?: string;
  /** Renders a PDF part, which shows as text without it */
  renderPdf?: (data: Uint8Array) => ReactNode;
  /** Passed to the viewer of each text part */
  textViewerProps?: Pick<TextViewerProps, "extensions" | "formatText" | "renderEditor">;
  ErrorBoundary?: TabContentProps["ErrorBoundary"];
}

type ViewerOptions = Pick<MultipartViewerProps, "renderPdf" | "textViewerProps" | "ErrorBoundary">;

export function MultipartViewer({
  data,
  boundary,
  idPrefix = "multipart",
  ...options
}: MultipartViewerProps) {
  // Parsed once per bytes and boundary, however often this renders
  const parseResult = useMemo<
    { result: MultipartParseResult; error: null } | { result: null; error: string }
  >(() => {
    try {
      return { result: parseMultipart(data, boundary), error: null };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [data, boundary]);

  if (parseResult.error != null) {
    return (
      <Banner color="danger" className="m-3">
        Failed to parse multipart data: {parseResult.error}
      </Banner>
    );
  }

  const { parts, complete } = parseResult.result;
  if (parts.length === 0) {
    return (
      <Banner color="info" className="m-3">
        No multipart parts found
      </Banner>
    );
  }

  const tabs = (
    <Tabs
      addBorders
      label="Multipart"
      layout="horizontal"
      tabListClassName="border-r border-r-border -ml-3"
      tabs={parts.map((part, i) => ({
        label: partLabel(part, i),
        value: tabValue(part, i),
        rightSlot:
          part.filename && part.mediaType?.startsWith("image/") ? (
            <div className="h-5 w-5 overflow-auto flex items-center justify-end">
              <ImageViewer
                data={toArrayBuffer(part.body)}
                mimeType={part.mediaType}
                className="ml-auto w-auto rounded-sm overflow-hidden"
              />
            </div>
          ) : part.filename ? (
            <Icon icon="file" />
          ) : null,
      }))}
    >
      {parts.map((part, i) => (
        <TabContent
          // oxlint-disable-next-line react/no-array-index-key -- Nothing else to key on
          key={idPrefix + (part.name ?? "") + i}
          value={tabValue(part, i)}
          className="pl-3 pt-0!"
          ErrorBoundary={options.ErrorBoundary}
        >
          <Part part={part} idPrefix={`${idPrefix}.${i}`} {...options} />
        </TabContent>
      ))}
    </Tabs>
  );

  if (complete) return tabs;
  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
      <Banner color="warning" className="mb-2 mr-3 text-sm">
        The body ends without its closing boundary; showing the parts that arrived.
      </Banner>
      {tabs}
    </div>
  );
}

function Part({
  part,
  idPrefix,
  ...options
}: { part: MultipartPart; idPrefix: string } & ViewerOptions) {
  if (part.mediaType === "application/http") {
    const message = parseHttpMessage(part.body);
    if (message != null) {
      return <HttpMessagePart message={message} idPrefix={idPrefix} {...options} />;
    }
  }
  return (
    <PartBody body={part.body} contentType={part.contentType} idPrefix={idPrefix} {...options} />
  );
}

/** An `application/http` part, as in Google and OData batches: an HTTP message of its own */
function HttpMessagePart({
  message,
  idPrefix,
  ...options
}: { message: HttpMessage; idPrefix: string } & ViewerOptions) {
  return (
    <div className="h-full grid grid-rows-[auto_auto_minmax(0,1fr)] gap-y-2">
      <div className="font-mono text-sm pt-1 truncate">
        {message.status != null ? (
          <HttpStatusTagRaw
            status={message.status}
            statusReason={message.statusReason}
            showReason
          />
        ) : (
          <span>
            <span className="text-info">{message.method}</span> {message.url}
          </span>
        )}
      </div>
      <HeadersTable title="Headers" headers={message.headers} labelColor="primary" defaultOpen />
      <PartBody
        body={message.body}
        contentType={headerValue(message.headers, "content-type")}
        idPrefix={idPrefix}
        {...options}
      />
    </div>
  );
}

/** A body by its own content type: the viewer the response pane would pick for it */
function PartBody({
  body,
  contentType,
  idPrefix,
  renderPdf,
  textViewerProps,
  ErrorBoundary,
}: {
  body: Uint8Array;
  contentType: string | null;
  idPrefix: string;
} & ViewerOptions) {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase() || null;

  const { content, detectedLanguage, binary } = useMemo(() => {
    const content = new TextDecoder().decode(body);
    const detectedLanguage = languageFromContentType(contentType, content);
    const binary = isBinaryPart(mediaType, body);
    return { content, detectedLanguage, binary };
  }, [body, contentType, mediaType]);

  if (body.length === 0) {
    return <div className="text-text-subtlest text-sm italic pt-1">Empty</div>;
  }

  if (mediaType?.startsWith("multipart/")) {
    const nestedBoundary = boundaryFromContentType(contentType);
    if (nestedBoundary != null) {
      return (
        <MultipartViewer
          data={body}
          boundary={nestedBoundary}
          idPrefix={idPrefix}
          renderPdf={renderPdf}
          textViewerProps={textViewerProps}
          ErrorBoundary={ErrorBoundary}
        />
      );
    }
  }

  if (mediaType?.match(/^image\/svg/i)) {
    return <SvgViewer text={content} className="pb-2" />;
  }

  if (mediaType?.match(/^image/i)) {
    return <ImageViewer data={toArrayBuffer(body)} mimeType={mediaType} className="pb-2" />;
  }

  if (mediaType?.match(/^audio/i)) {
    return <AudioViewer data={body} mimeType={mediaType} />;
  }

  if (mediaType?.match(/^video/i)) {
    return <VideoViewer data={body} />;
  }

  if (mediaType?.match(/csv|tab-separated/i)) {
    return <CsvViewer text={content} className="bg-primary h-10 w-10" />;
  }

  if (mediaType?.match(/^text\/html/i) || (!binary && detectedLanguage === "html")) {
    return <WebPageViewer html={content} />;
  }

  if (mediaType?.match(/pdf/i) && renderPdf != null) {
    return renderPdf(body);
  }

  if (binary) {
    return <HexdumpViewer data={body} renderEditor={textViewerProps?.renderEditor} />;
  }

  return (
    <TextViewer {...textViewerProps} text={content} language={detectedLanguage} stateKey={null} />
  );
}

/** Text types are shown as text even with odd bytes; anything else is binary if its bytes say so */
function isBinaryPart(mediaType: string | null, body: Uint8Array): boolean {
  if (
    mediaType != null &&
    /^text\/|json|xml|javascript|yaml|csv|x-www-form-urlencoded/.test(mediaType)
  ) {
    return false;
  }
  return isProbablyBinary(body);
}

function partLabel(part: MultipartPart, i: number): string {
  return part.name || part.filename || part.contentId || `Part ${i + 1}`;
}

function tabValue(part: MultipartPart, i: number) {
  return `${part.name ?? ""}::${i}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}
