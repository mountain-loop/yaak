import { LanguageSupport, LRLanguage } from '@codemirror/language';
import { parser } from './url';

const urlLanguage = LRLanguage.define({
  name: 'url',
  parser,
  languageData: {},
});

export function url() {
  return new LanguageSupport(urlLanguage, []);
}
