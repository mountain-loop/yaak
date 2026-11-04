import { queryOptions } from "@tanstack/react-query";
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

/** Characters looked at to tell text from binary */
const TEXT_SAMPLE = 64 * 1024;

/** The share of those that may be control characters or undecodable bytes in text */
const MAX_UNPRINTABLE = 0.1;

/**
 * The body as text, whatever its content type says, or null when it is binary. Valid UTF-8 is
 * text, and so are other bytes that are nearly all printable, as Latin-1 text is, decoded with
 * a replacement character for what isn't UTF-8. Either is binary when it is full of control
 * characters, as protobuf is.
 */
export function bodyAsText(bytes: Uint8Array, truncated = false): string | null {
  const text = bytesToText(bytes, truncated) ?? new TextDecoder("utf-8").decode(bytes);
  let total = 0;
  let unprintable = 0;
  for (const char of text) {
    if (total === TEXT_SAMPLE) break;
    total++;
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    if (control || code === 0x7f || code === 0xfffd) unprintable++;
  }
  return unprintable <= total * MAX_UNPRINTABLE ? text : null;
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
