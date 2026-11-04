import { hexy } from "hexy";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { CodeEditorProps } from "../editor/CodeEditor";
import { LazyCodeEditor } from "../editor/LazyCodeEditor";

/** Bytes as a hexdump: offset, hex and ASCII columns, one line per 16 bytes */
export function hexdump(data: Uint8Array | number[]): string {
  return data.length === 0 ? "" : hexy(data);
}

export interface HexdumpViewerProps {
  data: Uint8Array | number[];
  className?: string;
  /** Renders the editor, for a host whose editor builds on CodeEditor */
  renderEditor?: (props: CodeEditorProps) => ReactNode;
}

/** A read-only hexdump of binary data */
export function HexdumpViewer({
  data,
  className,
  renderEditor = renderCodeEditor,
}: HexdumpViewerProps) {
  const text = useMemo(() => hexdump(data), [data]);
  return renderEditor({
    language: "text",
    defaultValue: text,
    wrapLines: false,
    readOnly: true,
    stateKey: null,
    className,
  });
}

function renderCodeEditor(props: CodeEditorProps) {
  return <LazyCodeEditor {...props} />;
}
