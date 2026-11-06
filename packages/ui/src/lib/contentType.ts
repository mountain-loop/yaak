import type { EditorLanguage } from "@yaakapp-internal/plugins";

export function languageFromContentType(
  contentType: string | null,
  content: string | null = null,
): EditorLanguage | undefined {
  const justContentType = contentType?.split(";")[0] ?? contentType ?? "";
  if (justContentType.includes("json")) {
    return "json";
  }
  if (justContentType.includes("xml")) {
    return "xml";
  }
  if (justContentType.includes("html")) {
    const detected = languageFromContent(content);
    if (detected === "xml") {
      // If it's detected as XML, but is already HTML, don't change it
      return "html";
    }
    return detected;
  }
  if (justContentType.includes("javascript")) {
    // Sometimes `application/javascript` returns JSON, so try detecting that
    return languageFromContent(content, "javascript");
  }
  if (justContentType.includes("markdown")) {
    return "markdown";
  }

  return languageFromContent(content, "text");
}

export function languageFromContent(
  content: string | null,
  fallback?: EditorLanguage,
): EditorLanguage | undefined {
  if (content == null) return "text";

  const firstBytes = content.slice(0, 20).trim();

  if (firstBytes.startsWith("{") || firstBytes.startsWith("[")) {
    return "json";
  }
  if (
    firstBytes.toLowerCase().startsWith("<!doctype") ||
    firstBytes.toLowerCase().startsWith("<html")
  ) {
    return "html";
  }
  if (firstBytes.startsWith("<")) {
    return "xml";
  }

  return fallback;
}
