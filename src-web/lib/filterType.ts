import type { EditorProps } from '../components/core/Editor/Editor';

export type FilterType = 'jsonpath' | 'xpath' | 'generic';

export function getFilterType(language: EditorProps['language']): FilterType {
  if (language === 'json') return 'jsonpath';
  if (language === 'xml' || language === 'html') return 'xpath';
  return 'generic';
}
