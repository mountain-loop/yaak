import { LanguageSupport, LRLanguage } from '@codemirror/language';
import { parser } from './text';

export const textLanguage = LRLanguage.define({
  name: 'text',
  parser,
  languageData: {},
});

export function text() {
  return new LanguageSupport(textLanguage);
}
