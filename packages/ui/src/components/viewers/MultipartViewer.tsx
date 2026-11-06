import { type MultipartPart, parseMultipart } from "@mjackson/multipart-parser";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { languageFromContentType } from "../../lib/contentType";
import { Banner } from "../Banner";
import { Icon } from "../Icon";
import { TabContent, type TabContentProps, Tabs } from "../tabs/Tabs";
import { AudioViewer } from "./AudioViewer";
import { CsvViewer } from "./CsvViewer";
import { ImageViewer } from "./ImageViewer";
import { SvgViewer } from "./SvgViewer";
import { TextViewer, type TextViewerProps } from "./TextViewer";
import { VideoViewer } from "./VideoViewer";
import { WebPageViewer } from "./WebPageViewer";

export interface MultipartViewerProps {
  data: Uint8Array;
  boundary: string;
  idPrefix?: string;
  /** Renders a PDF part, which shows as text without it */
  renderPdf?: (data: Uint8Array) => ReactNode;
  /** Passed to the viewer of each text part */
  textViewerProps?: Pick<TextViewerProps, "extensions" | "formatText" | "renderEditor">;
  ErrorBoundary?: TabContentProps["ErrorBoundary"];
}

export function MultipartViewer({
  data,
  boundary,
  idPrefix = "multipart",
  renderPdf,
  textViewerProps,
  ErrorBoundary,
}: MultipartViewerProps) {
  const parseResult = useMemo(() => {
    try {
      const maxFileSize = 1024 * 1024 * 10; // 10MB
      const parsed = parseMultipart(data, { boundary, maxFileSize });
      const parts = Array.from(parsed);
      return { parts, error: null };
    } catch (err) {
      return { parts: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [data, boundary]);

  const { parts, error } = parseResult;

  if (error) {
    return (
      <Banner color="danger" className="m-3">
        Failed to parse multipart data: {error}
      </Banner>
    );
  }

  if (parts.length === 0) {
    return (
      <Banner color="info" className="m-3">
        No multipart parts found
      </Banner>
    );
  }

  return (
    <Tabs
      addBorders
      label="Multipart"
      layout="horizontal"
      tabListClassName="border-r border-r-border -ml-3"
      tabs={parts.map((part, i) => ({
        label: part.name ?? "",
        value: tabValue(part, i),
        rightSlot:
          part.filename && part.headers.contentType.mediaType?.startsWith("image/") ? (
            <div className="h-5 w-5 overflow-auto flex items-center justify-end">
              <ImageViewer
                data={part.arrayBuffer}
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
          key={idPrefix + part.name + i}
          value={tabValue(part, i)}
          className="pl-3 pt-0!"
          ErrorBoundary={ErrorBoundary}
        >
          <Part part={part} renderPdf={renderPdf} textViewerProps={textViewerProps} />
        </TabContent>
      ))}
    </Tabs>
  );
}

function Part({
  part,
  renderPdf,
  textViewerProps,
}: { part: MultipartPart } & Pick<MultipartViewerProps, "renderPdf" | "textViewerProps">) {
  const mimeType = part.headers.contentType.mediaType ?? null;
  const contentTypeHeader = part.headers.get("content-type");

  const { uint8Array, content, detectedLanguage } = useMemo(() => {
    const uint8Array = new Uint8Array(part.arrayBuffer);
    const content = new TextDecoder().decode(part.arrayBuffer);
    const detectedLanguage = languageFromContentType(contentTypeHeader, content);
    return { uint8Array, content, detectedLanguage };
  }, [part, contentTypeHeader]);

  if (mimeType?.match(/^image\/svg/i)) {
    return <SvgViewer text={content} className="pb-2" />;
  }

  if (mimeType?.match(/^image/i)) {
    return <ImageViewer data={part.arrayBuffer} className="pb-2" />;
  }

  if (mimeType?.match(/^audio/i)) {
    return <AudioViewer data={uint8Array} />;
  }

  if (mimeType?.match(/^video/i)) {
    return <VideoViewer data={uint8Array} />;
  }

  if (mimeType?.match(/csv|tab-separated/i)) {
    return <CsvViewer text={content} className="bg-primary h-10 w-10" />;
  }

  if (mimeType?.match(/^text\/html/i) || detectedLanguage === "html") {
    return <WebPageViewer html={content} />;
  }

  if (mimeType?.match(/pdf/i) && renderPdf != null) {
    return renderPdf(uint8Array);
  }

  return (
    <TextViewer {...textViewerProps} text={content} language={detectedLanguage} stateKey={null} />
  );
}

function tabValue(part: MultipartPart, i: number) {
  return `${part.name ?? ""}::${i}`;
}
