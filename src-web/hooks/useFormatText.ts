import { useQuery } from '@tanstack/react-query';
import type { EditorProps } from '../components/core/Editor';
import { tryFormatJson, tryFormatXml } from '../lib/formatters';

export function useFormatText({
  text,
  language,
  pretty,
}: {
  text: string;
  language: EditorProps['language'];
  pretty: boolean;
}) {
  return useQuery({
    queryKey: [text, language, pretty],
    queryFn: async () => {
      if (text === '' || !pretty) {
        return text;
      } else if (language === 'json') {
        return tryFormatJson(text);
      } else if (language === 'xml' || language === 'html') {
        return tryFormatXml(text);
      } else {
        return text;
      }
    },
  });
}
