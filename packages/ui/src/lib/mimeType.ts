import { MIMEType } from "whatwg-mimetype";

export function isJSON(content: string | null | undefined): boolean {
  if (typeof content !== "string") return false;

  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

export function isProbablyTextContentType(contentType: string | null): boolean {
  if (contentType == null) return false;

  const mimeType = getMimeTypeFromContentType(contentType).essence;
  const normalized = mimeType.toLowerCase();

  // Check if it starts with "text/"
  if (normalized.startsWith("text/")) {
    return true;
  }

  // Common text mimetypes and suffixes
  return [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/yaml",
    "+json",
    "+xml",
    "+yaml",
    "+text",
  ].some((textType) => normalized === textType || normalized.endsWith(textType));
}

export function getMimeTypeFromContentType(contentType: string): MIMEType {
  try {
    return new MIMEType(contentType);
  } catch {
    return new MIMEType("text/plain");
  }
}
