import { lazy, Suspense } from "react";
import type { CodeEditorProps } from "./CodeEditor";

const CodeEditor_ = lazy(() => import("./CodeEditor").then((m) => ({ default: m.CodeEditor })));

export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense>
      <CodeEditor_ {...props} />
    </Suspense>
  );
}
