import { hexy } from "hexy";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { CodeEditorProps } from "../editor/CodeEditor";
import { LazyCodeEditor } from "../editor/LazyCodeEditor";

/** Hexdumps already made, by the bytes they were made of, for as long as those bytes live */
const hexdumps = new WeakMap<Uint8Array | number[], string>();

/**
 * Bytes as a hexdump: offset, hex and ASCII columns, one line per 16 bytes. Made once for the
 * same bytes, so a viewer and its copy action share one.
 */
export function hexdump(data: Uint8Array | number[]): string {
  if (data.length === 0) return "";
  let dump = hexdumps.get(data);
  if (dump == null) {
    dump = hexy(data);
    hexdumps.set(data, dump);
  }
  return dump;
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
