import type { HttpResponse } from '@yaakapp-internal/models';
import { useHttpRequestBody } from '../hooks/useHttpRequestBody';
import { languageFromContentType } from '../lib/contentType';
import { EmptyStateText } from './EmptyStateText';
import { Editor } from './core/Editor/LazyEditor';
import { LoadingIcon } from './core/LoadingIcon';

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

  const { bodyText } = data;

  // Try to detect language from content-type header that was sent
  const contentTypeHeader = response.requestHeaders.find(
    (h) => h.name.toLowerCase() === 'content-type',
  );
  const contentType = contentTypeHeader?.value ?? null;
  const language = languageFromContentType(contentType, bodyText);

  return (
    <Editor
      readOnly
      defaultValue={bodyText}
      language={language}
      stateKey={`request.body.${response.id}`}
    />
  );
}
