import { styleTags, tags as t } from '@lezer/highlight';

export const highlight = styleTags({
  TagOpen: t.bracket,
  TagClose: t.bracket,
  TagContent: t.keyword,
});
