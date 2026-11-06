import { styleTags, tags as t } from "@lezer/highlight";

export const highlight = styleTags({
  TagOpen: t.bracket,
  TagClose: t.bracket,
  TagContent: t.keyword,
  // Strings are part of the tag body, so they get the same color as the rest of it
  TagString: t.keyword,
});
