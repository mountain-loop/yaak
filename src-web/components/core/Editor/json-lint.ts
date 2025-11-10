import type { Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { parse as jsonLintParse } from '@prantlf/jsonlint';

const TEMPLATE_SYNTAX_REGEX = /\$\{\[[\s\S]*?]}/g;

export function jsonParseLinter() {
  return (view: EditorView): Diagnostic[] => {
    try {
      const doc = view.state.doc.toString();
      // We need lint to not break on stuff like {"foo:" ${[ ... ]}} so we'll replace all template
      // syntax with repeating `1` characters, so it's valid JSON and the position is still correct.
      const escapedDoc = doc.replace(TEMPLATE_SYNTAX_REGEX, '1');
      jsonLintParse(escapedDoc);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!('location' in err)) {
        return [];
      }

      // const line = location?.start?.line;
      // const column = location?.start?.column;
      if (err.location.start.offset) {
        return [
          {
            from: err.location.start.offset,
            to: err.location.start.offset,
            severity: 'error',
            message: err.message,
          },
        ];
      }
    }
    return [];
  };
}
