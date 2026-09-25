/**
 * Matches a template tag up to the first `]}`, the same way the Lezer grammar and the JSON
 * linter close a tag. Quoted arguments may contain spaces, so this can't stop at whitespace.
 */
const TEMPLATE_TAG_REGEX = /\$\{\[[\s\S]*?]}/g;

export function validateHttpHeader(v: string): boolean {
  if (v === "") {
    return true;
  }

  // Template strings are not allowed so we replace them with a valid example string
  const withoutTemplateStrings = v.replace(TEMPLATE_TAG_REGEX, "123");
  return withoutTemplateStrings.match(/^[a-zA-Z0-9-_]+$/) !== null;
}
