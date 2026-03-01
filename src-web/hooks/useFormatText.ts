import { useQuery } from '@tanstack/react-query';
import type { EditorProps } from '../components/core/Editor/Editor';
import { tryFormatJson, tryFormatXml } from '../lib/formatters';
import { useAtomValue } from 'jotai';
import { settingsAtom } from '@yaakapp-internal/models';

export function useFormatText({
  text,
  language,
  pretty,
}: {
  text: string;
  language: EditorProps['language'];
  pretty: boolean;
}) {
  const settings = useAtomValue(settingsAtom);

  return useQuery({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: [text, language, pretty, settings.editorIndentation],
    queryFn: async () => {
      if (text === '' || !pretty) {
        return text;
      }
      if (language === 'json') {
        return tryFormatJson(text);
      }
      if (language === 'xml' || language === 'html') {
        return tryFormatXml(text);
      }
      return text;
    },
  }).data;
}
