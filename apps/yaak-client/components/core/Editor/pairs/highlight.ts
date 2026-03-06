import { styleTags, tags as t } from '@lezer/highlight';

export const highlight = styleTags({
  Sep: t.bracket,
  Key: t.attributeName,
  Value: t.string,
});
