import type { Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { parse as jsonLintParse } from '@prantlf/jsonlint';

const TEMPLATE_SYNTAX_REGEX = /\$\{\[[\s\S]*?]}/g;
const COMMENT_REGEX = /\/\/.*|\/\*[\s\S]*?\*\//g;

export function jsonParseLinter() {
  return (view: EditorView): Diagnostic[] => {
    try {
      const doc = view.state.doc.toString();

      const escapedDoc = doc
        .replace(TEMPLATE_SYNTAX_REGEX, (m) => '1'.repeat(m.length))
        .replace(COMMENT_REGEX, (m) => ' '.repeat(m.length));

      jsonLintParse(escapedDoc);
      // biome-ignore lint/suspicious/noExplicitAny: none
    } catch (err: any) {
      if (!('location' in err)) {
        return [];
      }

      if (err.location?.start?.offset !== undefined) {
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
