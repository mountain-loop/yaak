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

  const bodyText = text.data;
  const bodyBytes = bytes.data;
  if (bodyText == null || bodyText.length === 0 || bodyBytes == null) {
    return <EmptyStateText>No request body</EmptyStateText>;
  }

  const mimeType = contentType ? getMimeTypeFromContentType(contentType).essence : null;
  const language = languageFromContentType(contentType, bodyText);

  // Route to appropriate viewer based on content type
  if (mimeType?.match(/^multipart/i)) {
    const boundary = contentType?.split("boundary=")[1] ?? "unknown";
    // Create a copy because parseMultipart may detach the buffer
    const bodyCopy = new Uint8Array(bodyBytes);
    return <MultipartViewer data={bodyCopy} boundary={boundary} idPrefix={`request.${id}`} />;
  }

  if (mimeType?.match(/^image\/svg/i)) {
    return <SvgViewer text={bodyText} />;
  }

  if (mimeType?.match(/^image/i)) {
    return <ImageViewer data={bodyBytes.buffer as ArrayBuffer} />;
  }

  if (mimeType?.match(/^audio/i)) {
    return <AudioViewer data={bodyBytes} />;
  }

  if (mimeType?.match(/^video/i)) {
    return <VideoViewer data={bodyBytes} />;
  }

  if (mimeType?.match(/csv|tab-separated/i)) {
    return <CsvViewer text={bodyText} />;
  }

  if (mimeType?.match(/^text\/html/i)) {
    return <WebPageViewer html={bodyText} />;
  }

  const appViewer = mimeType?.match(/pdf/i)
    ? renderBodyViewer?.({ source: "request", mimeType, viewMode: "pretty", body, complete: true })
    : null;
  if (appViewer != null) return appViewer;

  return <TextViewer text={bodyText} language={language} stateKey={`request.body.${id}`} />;
}
