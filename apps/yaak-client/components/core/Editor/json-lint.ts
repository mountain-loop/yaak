import {
  type JsonLintOptions,
  jsonParseLinter as baseJsonParseLinter,
} from "@yaakapp-internal/ui/editor";
import { replaceTemplateTags } from "../../../lib/templateTags";

export function jsonParseLinter(options?: Omit<JsonLintOptions, "escape">) {
  return baseJsonParseLinter({ ...options, escape: escapeTemplateTags });
}

// We need lint to not break on stuff like {"foo:" ${[ ... ]}} so we'll replace all template
// syntax with repeating `1` characters, so it's valid JSON and the position is still correct.
function escapeTemplateTags(doc: string): string {
  return replaceTemplateTags(doc, (m) => "1".repeat(m.end - m.start));
}
