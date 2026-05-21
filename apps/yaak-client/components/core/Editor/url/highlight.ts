import { styleTags, tags as t } from "@lezer/highlight";

export const highlight = styleTags({
  Protocol: t.comment,
  // Placeholder nodes are rendered as chip widgets by `pathParameters.ts`, which
  // replaces the underlying text — so a style on the text itself is invisible for
  // valid placeholders and only ever appears on the spurious nodes the widget
  // plugin filters out (e.g. the trailing `:literal` in `/:id:literal`).
  // PathSegment: t.tagName,
  // Host: t.variableName,
  // Path: t.bool,
  // Query: t.string,
});
