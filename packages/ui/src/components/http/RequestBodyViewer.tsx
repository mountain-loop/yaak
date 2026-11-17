import { formatSize } from "@yaakapp-internal/lib/formatSize";
import { languageFromContentType } from "../../lib/contentType";
import { getMimeTypeFromContentType } from "../../lib/mimeType";
import { EmptyStateText } from "../EmptyStateText";
import { useEditorHost } from "../EditorHost";
import { LoadingIcon } from "../LoadingIcon";
import { AudioViewer } from "../viewers/AudioViewer";
import { CsvViewer } from "../viewers/CsvViewer";
import { ImageViewer } from "../viewers/ImageViewer";
import { SvgViewer } from "../viewers/SvgViewer";
import { VideoViewer } from "../viewers/VideoViewer";
import { WebPageViewer } from "../viewers/WebPageViewer";
import type { HttpBodyLoader } from "./types";

interface Props {
  /** Identifies the body, for viewer state */
  id: string;
  /** The Content-Type the request was sent with */
  contentType: string | null;
  body: HttpBodyLoader;
}

/** The body a request was sent with, in the viewer its content type calls for */
export function RequestBodyViewer({ id, contentType, body }: Props) {
  return <RequestBodyViewerInner key={id} id={id} contentType={contentType} body={body} />;
}

function RequestBodyViewerInner({ id, contentType, body }: Props) {
  const { MultipartViewer, TextViewer, renderBodyViewer } = useEditorHost();
  const text = body.useText();
  const bytes = body.useBytes();

  if (text.isLoading || bytes.isLoading) {
    return (
      <EmptyStateText>
        <LoadingIcon />
      </EmptyStateText>
    );
  }

  const error = text.error ?? bytes.error;
  if (error) {
    return <EmptyStateText>Error loading request body: {error.message}</EmptyStateText>;
  }

  // Whether there's a body is the bytes' to say: a binary body has no text
  const bodyBytes = bytes.data;
  if (bodyBytes == null || bodyBytes.length === 0) {
    return <EmptyStateText>No request body</EmptyStateText>;
  }

  const mimeType = contentType ? getMimeTypeFromContentType(contentType).essence : null;

  // Route to appropriate viewer based on content type
  if (mimeType?.match(/^multipart/i)) {
    const boundary = contentType?.split("boundary=")[1] ?? "unknown";
    // Create a copy because parseMultipart may detach the buffer
    const bodyCopy = new Uint8Array(bodyBytes);
    return <MultipartViewer data={bodyCopy} boundary={boundary} idPrefix={`request.${id}`} />;
  }

  if (mimeType?.match(/^image/i) && !mimeType.match(/^image\/svg/i)) {
    return <ImageViewer data={bodyBytes.buffer as ArrayBuffer} />;
  }

  if (mimeType?.match(/^audio/i)) {
    return <AudioViewer data={bodyBytes} />;
  }

  if (mimeType?.match(/^video/i)) {
    return <VideoViewer data={bodyBytes} />;
  }

  const appViewer = mimeType?.match(/pdf/i)
    ? renderBodyViewer?.({ source: "request", mimeType, viewMode: "pretty", body, complete: true })
    : null;

  // The rest show text, which a body that isn't valid UTF-8 doesn't have
  const bodyText = text.data;
  if (bodyText == null || bodyText.length === 0) {
    return (
      appViewer ?? <EmptyStateText>Binary body, {formatSize(bodyBytes.length)}</EmptyStateText>
    );
  }

  if (mimeType?.match(/^image\/svg/i)) {
    return <SvgViewer text={bodyText} />;
  }

  if (mimeType?.match(/csv|tab-separated/i)) {
    return <CsvViewer text={bodyText} />;
  }

  if (mimeType?.match(/^text\/html/i)) {
    return <WebPageViewer html={bodyText} />;
  }

  if (appViewer != null) return appViewer;

  const language = languageFromContentType(contentType, bodyText);
  return <TextViewer text={bodyText} language={language} stateKey={`request.body.${id}`} />;
}
