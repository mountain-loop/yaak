import { Compartment, type Extension } from "@codemirror/state";
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
import { addCustomColumn, customPath } from "../lib/columns";
import { loadSeenValues } from "../lib/searchBox";
import { columnPrefsAtom } from "../lib/store";

/** The Add Column dialog is open */
export const addColumnDialogAtom = atom(false);

const FORM_ID = "add-column";

/**
 * Adds a column for a header or query parameter, named by its field as the search names it,
 * `header.x-request-id` or `query.page`, completed as the search box completes it
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
    return queryFilter({ schema: maps, loadValues: loadSeenValues });
  }, [schema]);
  const extensions = useMemo(() => [compartment.current.of(filter)], [filter]);
  useEffect(() => {
    handleRef.current?.dispatch({ effects: compartment.current.reconfigure(filter) });
  }, [filter]);
  const path = customPath(text);

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
          extensions={extensions}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.defaultPrevented) {
              e.preventDefault();
              submit();
            }
          }}
        />
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
