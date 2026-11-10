import { startCompletion } from "@codemirror/autocomplete";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { Schema } from "@yaakapp-internal/query";
import {
  Dialog,
  DialogFooter,
  Input,
  type InputHandle,
  LazyCodeEditor,
} from "@yaakapp-internal/ui";
import { queryFilter } from "@yaakapp-internal/ui/editor";
import { atom, useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRpcQuery } from "../hooks/useRpcQuery";
import {
  addCustomColumn,
  customPath,
  customPathProblem,
  fieldReferenceChanges,
} from "../lib/columns";
import { loadSeenValues } from "../lib/searchBox";
import { columnPrefsAtom } from "../lib/store";

/** The Add Column dialog is open */
export const addColumnDialogAtom = atom(false);

const FORM_ID = "add-column";

/** Keeps the field a reference to a field, `@header.x-cache`, whatever was typed or pasted */
const asFieldReference = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const changes = fieldReferenceChanges(tr.newDoc.toString());
  return changes.length === 0 ? tr : [tr, { changes, sequential: true }];
});

/** Opens completion on the fields while the field is focused and empty */
const completeWhenEmpty = [
  ViewPlugin.define((view) => {
    if (view.hasFocus && view.state.doc.length === 0) {
      queueMicrotask(() => startCompletion(view));
    }
    return {};
  }),
  EditorView.updateListener.of((update) => {
    if (update.focusChanged && update.view.hasFocus && update.state.doc.length === 0) {
      startCompletion(update.view);
    }
  }),
];

/**
 * Adds a column for a header or query parameter, named by a reference to its field as the search
 * names it, `@header.x-request-id` or `@query.page`, completed from the fields and the names seen
 */
export function AddColumnDialog() {
  const [open, setOpen] = useAtom(addColumnDialogAtom);
  if (!open) return null;
  return <AddColumnForm onClose={() => setOpen(false)} />;
}

function AddColumnForm({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const setPrefs = useSetAtom(columnPrefsAtom);
  const handleRef = useRef<InputHandle | null>(null);
  const schema = useRpcQuery("query_schema", {}, { staleTime: Infinity }).data?.schema;
  // Only the fields a column can show: the maps of headers and query parameters. It goes in
  // once the schema is read, through a compartment, as the search box's does.
  const compartment = useRef(new Compartment());
  const filter = useMemo<Extension>(() => {
    if (schema == null) return [];
    const maps: Schema = { ...schema, fields: schema.fields.filter((f) => f.map) };
    return [
      queryFilter({ schema: maps, loadValues: loadSeenValues, fieldsOnly: true }),
      completeWhenEmpty,
    ];
  }, [schema]);
  const extensions = useMemo(() => [asFieldReference, compartment.current.of(filter)], [filter]);
  useEffect(() => {
    handleRef.current?.dispatch({ effects: compartment.current.reconfigure(filter) });
  }, [filter]);
  const path = customPath(text);
  const problem = customPathProblem(text);

  const submit = () => {
    if (path == null) return;
    setPrefs((p) => addCustomColumn(p, path));
    onClose();
  };

  return (
    <Dialog open onClose={onClose} size="dynamic" title="Add Column" className="w-[26rem]">
      <form
        id={FORM_ID}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          renderEditor={(props) => <LazyCodeEditor {...props} />}
          setRef={(h) => {
            handleRef.current = h;
          }}
          label="Field"
          autoFocus
          className="font-mono text-xs"
          stateKey={null}
          language={null}
          placeholder="@header.x-request-id"
          defaultValue=""
          onChange={setText}
          validate={problem == null}
          extensions={extensions}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.defaultPrevented) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="h-5 pt-1 text-xs text-danger">{problem}</div>
      </form>
      <DialogFooter
        actions={[
          { label: "Cancel", variant: "border", onClick: onClose },
          { label: "Add", color: "primary", form: FORM_ID, disabled: path == null },
        ]}
      />
    </Dialog>
  );
}
