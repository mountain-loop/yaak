import { LanguageSupport, LRLanguage } from '@codemirror/language';
import { parser } from './pairs';

const language = LRLanguage.define({
  name: 'pairs',
  parser,
  languageData: {},
});

export function pairs() {
  return new LanguageSupport(language, []);
}
