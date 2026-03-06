import type { Extension, TransactionSpec } from '@codemirror/state';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';

/**
 * A CodeMirror extension that forces single-line input by stripping
 * all newline characters from user input, including pasted content.
 *
 * This extension uses a transaction filter to intercept user input,
 * removes any newline characters, and adjusts the selection to the end
 * of the inserted text.
 *
 * IME composition events are ignored to preserve proper input behavior
 * for non-Latin languages.
 *
 * @returns A CodeMirror extension that enforces single-line editing.
 */
export function singleLineExtensions(): Extension {
  return EditorState.transactionFilter.of(
    (tr: Transaction): TransactionSpec | readonly TransactionSpec[] => {
      if (!tr.isUserEvent('input') || tr.isUserEvent('input.type.compose')) return tr;

      const changes: { from: number; to: number; insert: string }[] = [];

      tr.changes.iterChanges((_fromA, toA, fromB, _toB, inserted) => {
        let insert = '';
        for (const line of inserted.iterLines()) {
          insert += line.replace(/\n/g, '');
        }

        if (insert !== inserted.toString()) {
          changes.push({ from: fromB, to: toA, insert });
        }
      });

      const lastChange = changes[changes.length - 1];
      if (lastChange == null) return tr;

      const selection = EditorSelection.cursor(lastChange.from + lastChange.insert.length);

      return {
        changes,
        selection,
        userEvent: tr.annotation(Transaction.userEvent) ?? undefined,
      };
    },
  );
}
