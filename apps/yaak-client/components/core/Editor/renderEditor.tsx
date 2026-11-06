import type { CodeEditorProps } from "@yaakapp-internal/ui/editor";
import { Editor } from "./LazyEditor";

/** Renders a ui component's editor as the client's, with its settings and value handling */
export function renderEditor({ extensions, ...props }: CodeEditorProps) {
  return <Editor {...props} extraExtensions={extensions} />;
}
