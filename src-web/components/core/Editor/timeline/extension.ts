import { LanguageSupport, LRLanguage } from '@codemirror/language';
import { parser } from './timeline';

export const timelineLanguage = LRLanguage.define({
  name: 'timeline',
  parser,
  languageData: {},
});

export function timeline() {
  return new LanguageSupport(timelineLanguage);
}
