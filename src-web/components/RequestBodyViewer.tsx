import type { HttpResponse } from '@yaakapp-internal/models';
import { useHttpRequestBody } from '../hooks/useHttpRequestBody';
import { getMimeTypeFromContentType, languageFromContentType } from '../lib/contentType';
import { EmptyStateText } from './EmptyStateText';
import { LoadingIcon } from './core/LoadingIcon';
import { CsvViewer } from './responseViewers/CsvViewer';
import { ImageViewer } from './responseViewers/ImageViewer';
import { SvgViewer } from './responseViewers/SvgViewer';
import { TextViewer } from './responseViewers/TextViewer';
import { WebPageViewer } from './responseViewers/WebPageViewer';

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
  if (mimeType?.match(/^image\/svg/i)) {
    return <SvgViewer text={bodyText} />;
  }

  if (mimeType?.match(/^image/i)) {
    return <ImageViewer data={body.buffer} />;
  }

  if (mimeType?.match(/csv|tab-separated/i)) {
    return <CsvViewer text={bodyText} />;
  }

  if (mimeType?.match(/^text\/html/i)) {
    return <WebPageViewer html={bodyText} />;
  }

  return (
    <TextViewer text={bodyText} language={language} stateKey={`request.body.${response.id}`} />
  );
}
