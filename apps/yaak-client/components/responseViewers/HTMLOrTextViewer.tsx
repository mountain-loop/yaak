import type { HttpResponse } from '@yaakapp-internal/models';
import { useMemo, useState } from 'react';
import { useResponseBodyText } from '../../hooks/useResponseBodyText';
import { languageFromContentType } from '../../lib/contentType';
import { getContentTypeFromHeaders } from '../../lib/model_util';
import type { EditorProps } from '../core/Editor/Editor';
import { EmptyStateText } from '../EmptyStateText';
import { TextViewer } from './TextViewer';
import { WebPageViewer } from './WebPageViewer';

interface Props {
  response: HttpResponse;
  pretty: boolean;
  textViewerClassName?: string;
}

export function HTMLOrTextViewer({ response, pretty, textViewerClassName }: Props) {
  const rawTextBody = useResponseBodyText({ response, filter: null });
  const contentType = getContentTypeFromHeaders(response.headers);
  const language = languageFromContentType(contentType, rawTextBody.data ?? '');

  if (rawTextBody.isLoading || response.state === 'initialized') {
    return null;
  }

  if (language === 'html' && pretty) {
    return <WebPageViewer html={rawTextBody.data ?? ''} baseUrl={response.url} />;
  }
  if (rawTextBody.data == null) {
    return <EmptyStateText>Empty response</EmptyStateText>;
  }
  return (
    <HttpTextViewer
      response={response}
      text={rawTextBody.data}
      language={language}
      pretty={pretty}
      className={textViewerClassName}
    />
  );
}

interface HttpTextViewerProps {
  response: HttpResponse;
  text: string;
  language: EditorProps['language'];
  pretty: boolean;
  className?: string;
}

function HttpTextViewer({ response, text, language, pretty, className }: HttpTextViewerProps) {
  const [currentFilter, setCurrentFilter] = useState<string | null>(null);
  const filteredBody = useResponseBodyText({ response, filter: currentFilter });

  const filterCallback = useMemo(
    () => (filter: string) => {
      setCurrentFilter(filter);
      return {
        data: filteredBody.data,
        isPending: filteredBody.isPending,
        error: !!filteredBody.error,
      };
    },
    [filteredBody],
  );

  return (
    <TextViewer
      text={text}
      language={language}
      stateKey={`response.body.${response.id}`}
      pretty={pretty}
      className={className}
      onFilter={filterCallback}
    />
  );
}
