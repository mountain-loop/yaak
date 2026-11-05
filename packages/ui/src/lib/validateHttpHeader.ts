import { replaceTemplateTags } from "./templateTags";

export function validateHttpHeader(v: string): boolean {
  if (v === "") {
    return true;
  }

  // Template strings are not allowed so we replace them with a valid example string
  const withoutTemplateStrings = replaceTemplateTags(v, () => "123");
  return withoutTemplateStrings.match(/^[a-zA-Z0-9-_]+$/) !== null;
}
