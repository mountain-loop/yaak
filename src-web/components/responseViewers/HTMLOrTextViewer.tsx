import type { HttpResponse } from '@yaakapp-internal/models';
import { useResponseBodyText } from '../../hooks/useResponseBodyText';
import { languageFromContentType } from '../../lib/contentType';
import { getContentTypeFromHeaders } from '../../lib/model_util';
import { EmptyStateText } from '../EmptyStateText';
import { TextViewer } from './TextViewer';
import { WebPageViewer } from './WebPageViewer';

interface Props {
  response: HttpResponse;
  pretty: boolean;
  textViewerClassName?: string;
}

export function HTMLOrTextViewer({ response, pretty, textViewerClassName }: Props) {
  const rawTextBody = useResponseBodyText({ responseId: response.id, filter: null });
  const contentType = getContentTypeFromHeaders(response.headers);
  const language = languageFromContentType(contentType, rawTextBody.data ?? '');

  if (rawTextBody.isLoading || response.state === 'initialized') {
    return null;
  }

  if (language === 'html' && pretty) {
    return <WebPageViewer response={response} />;
  } else if (rawTextBody.data == null) {
    return <EmptyStateText>Empty response</EmptyStateText>;
  } else {
    return (
      <TextViewer
        language={language}
        text={rawTextBody.data}
        pretty={pretty}
        className={textViewerClassName}
        responseId={response.id}
        requestId={response.requestId}
      />
    );
  }
}
