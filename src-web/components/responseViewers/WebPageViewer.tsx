import { useMemo } from 'react';
import { useResponseBodyText } from '../../hooks/useResponseBodyText';
import type { HttpResponse } from '@yaakapp-internal/models';

interface Props {
  response: HttpResponse;
}

export function WebPageViewer({ response }: Props) {
  const { url } = response;
  const body = useResponseBodyText(response).data ?? '';

  const contentForIframe: string | undefined = useMemo(() => {
    if (body.includes('<head>')) {
      return body.replace(/<head>/gi, `<head><base href="${url}"/>`);
    }
    return body;
  }, [url, body]);

  return (
    <div className="h-full pb-3">
      <iframe
        key={body ? 'has-body' : 'no-body'}
        title="Yaak response preview"
        srcDoc={contentForIframe}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        className="h-full w-full rounded border border-border-subtle"
      />
    </div>
  );
}
