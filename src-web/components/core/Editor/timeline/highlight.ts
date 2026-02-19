import { styleTags, tags as t } from '@lezer/highlight';

export const highlight = styleTags({
  OutgoingText: t.propertyName, // > lines - primary color (matches timeline icons)
  IncomingText: t.tagName, // < lines - info color (matches timeline icons)
  InfoText: t.comment, // * lines - subtle color (matches timeline icons)
});
