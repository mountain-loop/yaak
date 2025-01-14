import type { HttpResponse } from '@yaakapp-internal/models';
import { useContentTypeFromHeaders } from '../../hooks/useContentTypeFromHeaders';
import { useResponseBodyText } from '../../hooks/useResponseBodyText';
import { languageFromContentType } from '../../lib/contentType';
import { BinaryViewer } from './BinaryViewer';
import { TextViewer } from './TextViewer';
import { WebPageViewer } from './WebPageViewer';

interface Props {
  response: HttpResponse;
  pretty: boolean;
  textViewerClassName?: string;
}

export function HTMLOrTextViewer({ response, pretty, textViewerClassName }: Props) {
  const rawTextBody = useResponseBodyText(response);
  const language = languageFromContentType(
    useContentTypeFromHeaders(response.headers),
    rawTextBody.data ?? '',
  );

  if (rawTextBody.isLoading) {
    return null;
  }

  // Wasn't able to decode as text, so it must be binary
  if (rawTextBody.data == null) {
    return <BinaryViewer response={response} />;
  }

  if (language === 'html' && pretty) {
    return <WebPageViewer response={response} />;
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
