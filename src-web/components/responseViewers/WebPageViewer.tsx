import { useMemo } from 'react';

interface Props {
  html: string;
  baseUrl?: string;
}

export function WebPageViewer({ html, baseUrl }: Props) {
  const contentForIframe: string | undefined = useMemo(() => {
    if (baseUrl && html.includes('<head>')) {
      return html.replace(/<head>/gi, `<head><base href="${baseUrl}"/>`);
    }
    return html;
  }, [baseUrl, html]);

  return (
    <div className="h-full pb-3">
      <iframe
        key={html ? 'has-body' : 'no-body'}
        title="Yaak response preview"
        srcDoc={contentForIframe}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        className="h-full w-full rounded-lg border border-border-subtle"
      />
    </div>
  );
}
