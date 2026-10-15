import type { CodeEditorProps } from "@yaakapp-internal/ui/editor";
import { TextViewer as BaseTextViewer, type TextViewerProps } from "@yaakapp-internal/ui";
import { tryFormatJson, tryFormatXml } from "../../lib/formatters";
import { hyperlink } from "../core/Editor/hyperlink/extension";
import { renderEditor } from "../core/Editor/renderEditor";

export const textViewerExtensions = [hyperlink];

export function TextViewer(
  props: Omit<TextViewerProps, "extensions" | "formatText" | "renderEditor">,
) {
  return (
    <BaseTextViewer
      {...props}
      extensions={textViewerExtensions}
      formatText={formatText}
      renderEditor={renderEditor}
    />
  );
}

export async function formatText(
  text: string,
  language: CodeEditorProps["language"],
): Promise<string> {
  if (language === "json") {
    return tryFormatJson(text);
  }
  if (language === "xml" || language === "html") {
    return tryFormatXml(text);
  }
  return text;
}
