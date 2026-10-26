import type { FilterLanguage, FlowBody } from "@yaakapp-internal/proxy-lib";
import type { CodeEditorProps } from "@yaakapp-internal/ui/editor";
import vkBeautify from "vkbeautify";
import { rpc } from "./rpc";

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * The text of a body, or null when it isn't valid UTF-8. A truncated body may end partway
 * through a character, so up to three trailing bytes are dropped before giving up on it.
 */
export function bytesToText(bytes: Uint8Array, truncated = false): string | null {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const maxTrim = truncated ? Math.min(3, bytes.length) : 0;
  for (let trim = 0; trim <= maxTrim; trim++) {
    try {
      return decoder.decode(bytes.subarray(0, bytes.length - trim));
    } catch {
      // Try again without the last byte
    }
  }
  return null;
}

export async function formatText(
  text: string,
  language: CodeEditorProps["language"],
): Promise<string> {
  if (text === "") return text;
  try {
    if (language === "json") return await rpc("format_body", { text });
    if (language === "xml" || language === "html") return vkBeautify.xml(text, "  ");
  } catch (err) {
    console.warn("Failed to format body", err);
  }
  return text;
}

/** The filter syntax for a body the viewer detected as `language`: XPath for XML and HTML */
export function filterLanguage(language: CodeEditorProps["language"]): FilterLanguage | undefined {
  if (language === "json") return "jsonpath";
  if (language === "xml" || language === "html") return "xpath";
  return undefined;
}

export async function filterText(
  flowId: string,
  which: FlowBody,
  expression: string,
  language: CodeEditorProps["language"],
): Promise<string> {
  const result = await rpc("filter_body", {
    flowId,
    which,
    expression,
    language: filterLanguage(language),
  });
  if (result.error != null) throw new Error(result.error);
  return result.content;
}

/** The media type without parameters, lowercased: `application/json` */
export function mimeEssence(contentType: string | null): string | null {
  const essence = contentType?.split(";")[0]?.trim().toLowerCase();
  return essence ? essence : null;
}

/** What the flow list shows for a content type: `json` for `application/problem+json` */
export function shortContentType(contentType: string | null): string | null {
  const essence = mimeEssence(contentType);
  if (essence == null) return null;
  const subtype = essence.split("/")[1] ?? essence;
  const suffix = subtype.split("+").pop() ?? subtype;
  return suffix.replace(/^x-/, "");
}

export function findHeader(headers: { name: string; value: string }[], name: string) {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}
