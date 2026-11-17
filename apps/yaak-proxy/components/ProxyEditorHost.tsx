import {
  type EditorHost,
  EditorHostProvider,
  MultipartViewer,
  type MultipartViewerProps,
  TextViewer,
  type TextViewerProps,
} from "@yaakapp-internal/ui";
import { type ReactNode, useMemo } from "react";
import { formatText as engineFormatText } from "../lib/body";

/**
 * Gives the shared panes the proxy's formatting. Everything else keeps the shared defaults:
 * plain editors with no templating, state kept for the session, no dialogs.
 */
export function ProxyEditorHost({
  children,
  formatText = engineFormatText,
}: {
  children: ReactNode;
  /** Pretty-prints a body; the engine's formatter unless replaced */
  formatText?: TextViewerProps["formatText"];
}) {
  // Components made once per formatter, so viewers aren't remounted on every render
  const host = useMemo<Partial<EditorHost>>(
    () => ({
      TextViewer: (props: TextViewerProps) => <TextViewer formatText={formatText} {...props} />,
      MultipartViewer: (props: MultipartViewerProps) => (
        <MultipartViewer textViewerProps={{ formatText }} {...props} />
      ),
    }),
    [formatText],
  );
  return <EditorHostProvider value={host}>{children}</EditorHostProvider>;
}
