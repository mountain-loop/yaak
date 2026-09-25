import { TEMPLATE_TAG_REGEX } from "./templateTagRegex";

export function validateHttpHeader(v: string): boolean {
  if (v === "") {
    return true;
  }

  // Template strings are not allowed so we replace them with a valid example string
  const withoutTemplateStrings = v.replace(TEMPLATE_TAG_REGEX, "123");
  return withoutTemplateStrings.match(/^[a-zA-Z0-9-_]+$/) !== null;
}
