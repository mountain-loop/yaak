import type { HttpResponse } from '@yaakapp-internal/models';
import { lazy, Suspense } from 'react';
import { useHttpRequestBody } from '../hooks/useHttpRequestBody';
import { getMimeTypeFromContentType, languageFromContentType } from '../lib/contentType';
import { LoadingIcon } from './core/LoadingIcon';
import { EmptyStateText } from './EmptyStateText';
import { AudioViewer } from './responseViewers/AudioViewer';
import { CsvViewer } from './responseViewers/CsvViewer';
import { ImageViewer } from './responseViewers/ImageViewer';
import { MultipartViewer } from './responseViewers/MultipartViewer';
import { SvgViewer } from './responseViewers/SvgViewer';
import { TextViewer } from './responseViewers/TextViewer';
import { VideoViewer } from './responseViewers/VideoViewer';
import { WebPageViewer } from './responseViewers/WebPageViewer';

const PdfViewer = lazy(() =>
  import('./responseViewers/PdfViewer').then((m) => ({ default: m.PdfViewer })),
);

interface Props {
  response: HttpResponse;
}

export function RequestBodyViewer({ response }: Props) {
  return <RequestBodyViewerInner key={response.id} response={response} />;
}

function RequestBodyViewerInner({ response }: Props) {
  const { data, isLoading, error } = useHttpRequestBody(response);

  if (isLoading) {
    return (
      <EmptyStateText>
        <LoadingIcon />
      </EmptyStateText>
    );
  }

  if (error) {
    return <EmptyStateText>Error loading request body: {error.message}</EmptyStateText>;
  }

  if (data?.bodyText == null || data.bodyText.length === 0) {
    return <EmptyStateText>No request body</EmptyStateText>;
  }

  const { bodyText, body } = data;

  // Try to detect language from content-type header that was sent
  const contentTypeHeader = response.requestHeaders.find(
    (h) => h.name.toLowerCase() === 'content-type',
  );
  const contentType = contentTypeHeader?.value ?? null;
  const mimeType = contentType ? getMimeTypeFromContentType(contentType).essence : null;
  const language = languageFromContentType(contentType, bodyText);

  // Route to appropriate viewer based on content type
  if (mimeType?.match(/^multipart/i)) {
    const boundary = contentType?.split('boundary=')[1] ?? 'unknown';
    // Create a copy because parseMultipart may detach the buffer
    const bodyCopy = new Uint8Array(body);
    return (
      <MultipartViewer data={bodyCopy} boundary={boundary} idPrefix={`request.${response.id}`} />
    );
  }

  if (mimeType?.match(/^image\/svg/i)) {
    return <SvgViewer text={bodyText} />;
  }

  if (mimeType?.match(/^image/i)) {
    return <ImageViewer data={body.buffer} />;
  }

  if (mimeType?.match(/^audio/i)) {
    return <AudioViewer data={body} />;
  }

  if (mimeType?.match(/^video/i)) {
    return <VideoViewer data={body} />;
  }

  if (mimeType?.match(/csv|tab-separated/i)) {
    return <CsvViewer text={bodyText} />;
  }

  if (mimeType?.match(/^text\/html/i)) {
    return <WebPageViewer html={bodyText} />;
  }

  if (mimeType?.match(/pdf/i)) {
    return (
      <Suspense fallback={<LoadingIcon />}>
        <PdfViewer data={body} />
      </Suspense>
    );
  }

  return (
    <TextViewer text={bodyText} language={language} stateKey={`request.body.${response.id}`} />
  );
}
