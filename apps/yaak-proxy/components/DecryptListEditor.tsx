import { Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { DecryptListEntry, SeenTargets } from "@yaakapp-internal/proxy-lib";
import { Dialog, Icon, IconButton, Input } from "@yaakapp-internal/ui";
import { filterAutocomplete } from "@yaakapp-internal/ui/editor";
import classNames from "classnames";
import { atom, useAtom } from "jotai";
import { useMemo, useRef, useState } from "react";
import { useDecryptList, useSetDecryptList } from "../hooks/useDecryptList";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { decryptFilterOptions, entryLabel, normalizeEntry, withEntry } from "../lib/decrypt";

/**
 * What HTTPS is decrypted: one row per entry, the user's in order and then the built-in
 * exclusions, each removable, and an input that adds one, suggesting `host:`, `app:` and `!`,
 * then the hosts and apps seen in the capture. Saves as it changes. Placed by Settings; until
 * that exists, by the dialog the state pill's More… opens.
 */
export function DecryptListEditor({ className }: { className?: string }) {
  const list = useDecryptList();
  const save = useSetDecryptList();
  // Read when the input opens its suggestions, so new traffic shows without rebuilding it.
  const seen = useRpcQuery("list_seen", {}, { staleTime: 0, refetchOnMount: "always" });
  const seenRef = useRef<SeenTargets | undefined>(seen.data);
  seenRef.current = seen.data;

  // Each change replaces the whole list, so one waits for the last to land rather than undo it.
  const remove = (entry: string) => {
    if (save.isPending) return;
    save.mutate({ entries: list.filter((e) => e.entry !== entry).map((e) => e.entry) });
  };

  return (
    <div className={classNames(className, "grid gap-2")}>
      <EntryInput
        seenRef={seenRef}
        list={list}
        disabled={save.isPending}
        onAdd={(entry) => save.mutate({ entries: withEntry(list, entry) })}
      />
      <div className="rounded-md border border-border-subtle divide-y divide-border-subtle">
        {list.length === 0 && (
          <div className="px-3 py-2 text-sm text-text-subtle">Nothing decrypted</div>
        )}
        {list.map((e) => (
          <EntryRow
            key={e.entry}
            entry={e}
            disabled={save.isPending}
            onRemove={() => remove(e.entry)}
          />
        ))}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  disabled,
  onRemove,
}: {
  entry: DecryptListEntry;
  disabled: boolean;
  onRemove: () => void;
}) {
  const negated = entry.entry.startsWith("!");
  return (
    <div
      className={classNames(
        "group/entry flex items-center gap-2 h-xs pl-3 pr-1 text-sm",
        entry.builtIn && "text-text-subtlest",
      )}
    >
      <Icon
        icon={negated ? "lock" : "lock_open"}
        size="sm"
        className={classNames("shrink-0", entry.builtIn ? "opacity-60" : "text-text-subtle")}
        title={negated ? "Excluded" : "Decrypted"}
      />
      <span className={classNames("truncate", entry.entry !== "*" && "font-mono text-xs")}>
        {entryLabel(entry.entry)}
      </span>
      {entry.builtIn && (
        <span
          title="Ships with Yaak Proxy"
          className="shrink-0 text-2xs rounded px-1 border border-border-subtle"
        >
          built-in
        </span>
      )}
      <IconButton
        size="xs"
        icon="x"
        iconColor="secondary"
        title={`Remove ${entryLabel(entry.entry)}`}
        disabled={disabled}
        className="ml-auto opacity-0 group-hover/entry:opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
      />
    </div>
  );
}

/** The input that adds an entry on Enter, once the suggestions are closed or none is picked */
function EntryInput({
  seenRef,
  list,
  disabled,
  onAdd,
}: {
  seenRef: React.RefObject<SeenTargets | undefined>;
  list: DecryptListEntry[];
  /** A change is being saved; Enter waits for it, keeping what was typed */
  disabled: boolean;
  onAdd: (entry: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const listRef = useRef(list);
  listRef.current = list;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const extensions = useMemo(() => {
    const options = decryptFilterOptions(null);
    // The suggestions read the capture as they open, not as the input was made.
    for (const field of options.fields ?? []) {
      field.values = () => {
        const fresh = decryptFilterOptions(seenRef.current).fields ?? [];
        const values = fresh.find((f) => f.name === field.name)?.values;
        return Array.isArray(values) ? values : [];
      };
    }
    const add = (view: EditorView) => {
      const text = view.state.doc.toString();
      if (text.trim() === "") return false;
      if (disabledRef.current) return true;
      const entry = normalizeEntry(text);
      if (entry == null) {
        setError("Not a host or app");
        return true;
      }
      setError(null);
      if (!listRef.current.some((e) => e.entry === entry)) onAddRef.current(entry);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
      return true;
    };
    // Low, so Enter picks a suggestion while they are open.
    return [filterAutocomplete(options), Prec.low(keymap.of([{ key: "Enter", run: add }]))];
  }, [seenRef]);

  return (
    <div className="grid gap-1" title="Applies to new connections">
      <Input
        label="Add entry"
        hideLabel
        size="sm"
        stateKey={null}
        language={null}
        placeholder="Add host, app or *"
        extensions={extensions}
        onChange={() => setError(null)}
      />
      {error != null && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}

/** Opens the decrypt list from the state pill's More…, until Settings holds it */
export const decryptListDialogOpenAtom = atom(false);

export function DecryptListDialog() {
  const [open, setOpen] = useAtom(decryptListDialogOpenAtom);
  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      size="dynamic"
      title="Decrypt List"
      className="w-[36rem]"
    >
      <div className="pb-4">{open && <DecryptListEditor />}</div>
    </Dialog>
  );
}
