import { queryOptions } from "@tanstack/react-query";
import {
  contentTypeCharset,
  decodeBodyText,
  strictUtf8Text,
} from "@yaakapp-internal/lib/decodeBodyText";
import type { FilterLanguage, Flow, FlowBody } from "@yaakapp-internal/proxy-lib";
import type { CodeEditorProps } from "@yaakapp-internal/ui/editor";
import vkBeautify from "vkbeautify";
import { rpc } from "./rpc";

/** A flow's body for the viewer: decoded, or as it was on the wire when `decodeError` is set */
export function flowBodyQueryOptions(flow: Flow, which: FlowBody) {
  return queryOptions({
    queryKey: ["get_flow_body", flow.id, which, flow.updatedAt],
    queryFn: async () => {
      const res = await rpc("get_flow_body", { flowId: flow.id, which });
      return {
        bytes: base64ToBytes(res.data),
        truncated: res.truncated,
        storedSize: res.storedSize,
        decodeError: res.decodeError ?? null,
      };
    },
    // Reading a stored body fails the same way every time, so the error shows at once.
    retry: false,
  });
}

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
export const bytesToText = strictUtf8Text;

/** Characters looked at to tell text from binary */
const TEXT_SAMPLE = 64 * 1024;

/** The share of those that may be control characters or undecodable bytes in text */
const MAX_UNPRINTABLE = 0.1;

/**
 * The body as text, whatever its content type says, or null when it is binary. It is decoded in
 * its content type's charset, or else as UTF-8, or windows-1252 when it isn't valid UTF-8. It is
 * binary when it is full of control characters, as protobuf is, or, without a charset, of bytes
 * UTF-8 can't read: windows-1252 reads every byte as something, compressed data included.
 */
export function bodyAsText(
  bytes: Uint8Array,
  truncated = false,
  contentType: string | null = null,
): string | null {
  const text = decodeBodyText(bytes, contentType, { truncated });
  const judged =
    contentTypeCharset(contentType) != null
      ? text
      : (strictUtf8Text(bytes, truncated) ?? new TextDecoder("utf-8").decode(bytes));
  let total = 0;
  let unprintable = 0;
  for (const char of judged) {
    if (total === TEXT_SAMPLE) break;
    total++;
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    if (control || code === 0x7f || code === 0xfffd) unprintable++;
  }
  return unprintable <= total * MAX_UNPRINTABLE ? text : null;
}

/**
 * The body as the viewer reads it: text first, whatever its content type. An image is text only
 * when it is valid UTF-8, as no real one is, so one with long printable metadata stays an image.
 */
export function viewerText(
  bytes: Uint8Array,
  truncated: boolean,
  contentType: string | null,
): string | null {
  const mime = mimeEssence(contentType) ?? "";
  if (mime.startsWith("image/") && !mime.startsWith("image/svg")) {
    return strictUtf8Text(bytes, truncated);
  }
  return bodyAsText(bytes, truncated, contentType);
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

/** Extensions for media types whose subtype isn't one */
const EXTENSIONS: Record<string, string> = {
  "application/javascript": "js",
  "application/octet-stream": "bin",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "text/javascript": "js",
  "text/markdown": "md",
  "text/plain": "txt",
};

/** A name to offer for a saved body: the URL's file name, or one from the content type */
export function bodyFileName(flow: Flow, which: FlowBody): string {
  let last = "";
  try {
    last = decodeURIComponent(new URL(flow.url).pathname.split("/").pop() ?? "");
  } catch {
    // Not a URL, or not encoded properly
  }
  if (which === "response" && /^[^\\/:*?"<>|]+\.[a-z0-9]+$/i.test(last)) return last;
  const headers = which === "request" ? flow.requestHeaders : flow.responseHeaders;
  const contentType = findHeader(headers, "content-type");
  const essence = mimeEssence(contentType);
  const extension = (essence == null ? null : EXTENSIONS[essence]) ?? shortContentType(contentType);
  return `${which}.${extension?.replace(/[^a-z0-9-]/gi, "") || "bin"}`;
}

export function findHeader(headers: { name: string; value: string }[], name: string) {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}
