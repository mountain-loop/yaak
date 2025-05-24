import type {Extension, Transaction, TransactionSpec} from '@codemirror/state';
import { EditorSelection, EditorState } from '@codemirror/state';

export function singleLineExtensions(): Extension {
  return EditorState.transactionFilter.of(
    (tr: Transaction): TransactionSpec | TransactionSpec[] => {
      // Skip processing during IME composition
      if (!tr.isUserEvent('input') || tr.isUserEvent('composition')) return tr;

      const specs: TransactionSpec[] = [];
      tr.changes.iterChanges((_, toA, fromB, toB, inserted) => {
        let insert = '';
        let newlinesRemoved = 0;
        for (const line of inserted) {
          const newLine = line.replace('\n', '');
          newlinesRemoved += line.length - newLine.length;
          insert += newLine;
        }

        // Update cursor position based on how many newlines were removed
        const cursor = EditorSelection.cursor(toB - newlinesRemoved);
        const selection = EditorSelection.create([cursor], 0);

        const changes = [{ from: fromB, to: toA, insert }];
        specs.push({ ...tr, selection, changes });
      });

      return specs;
    },
  );
}
