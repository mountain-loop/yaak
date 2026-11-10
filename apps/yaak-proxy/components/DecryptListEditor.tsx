import { Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { DecryptListEntry, SeenTargets } from "@yaakapp-internal/proxy-lib";
import {
  Button,
  CONTROL_TOOLTIP_DELAY,
  Icon,
  IconButton,
  Input,
  SettingRow,
  SettingRowBoolean,
  Tooltip,
} from "@yaakapp-internal/ui";
import { filterAutocomplete } from "@yaakapp-internal/ui/editor";
import classNames from "classnames";
import { useMemo, useRef, useState } from "react";
import { canTrustHere, useDecrypt, useTrustCertificate, useTrusting } from "../hooks/useDecrypt";
import { useDecryptList } from "../hooks/useDecryptList";
import { useRpcQuery } from "../hooks/useRpcQuery";
import {
  decryptFilterOptions,
  decryptsEverything,
  entryLabel,
  entrySubject,
  EVERYTHING,
  everythingEdit,
  normalizeEntry,
} from "../lib/decrypt";
import { revealPath } from "../lib/opener";
import { useShowToast } from "../lib/toast";

/**
 * Settings' Decryption section: the certificate, Decrypt everything as a switch over `*`, then
 * the person's own hosts and apps in order, each removable, an input that adds one (suggesting
 * `host:`, `app:` and `!`, then the hosts and apps seen), and the built-in exclusions folded
 * into one row. Every change goes through Decrypt, so the first that decrypts something trusts
 * the certificate first.
 */
export function DecryptionSettings() {
  const list = useDecryptList();
  const { apply } = useDecrypt();
  const [busy, setBusy] = useState(false);
  // Read when the input opens its suggestions, so new traffic shows without rebuilding it.
  const seen = useRpcQuery("list_seen", {}, { staleTime: 0, refetchOnMount: "always" });
  const seenRef = useRef<SeenTargets | undefined>(seen.data);
  seenRef.current = seen.data;
  const everything = decryptsEverything(list);
  const own = list.filter((e) => !e.builtIn && e.entry !== EVERYTHING);
  const builtIns = list.filter((e) => e.builtIn);

  // One change at a time, each applied to the list as it is when it lands.
  const change = async (
    edit: { add: string[]; remove: string[] },
    message: string,
    sub?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      await apply({ edit, message, sub });
    } finally {
      setBusy(false);
    }
  };
  const remove = (entry: string) =>
    void change(
      { add: [], remove: [entry] },
      entry.startsWith("!")
        ? `Stopped excluding ${entrySubject(entry.slice(1))}`
        : `Stopped decrypting ${entrySubject(entry)}`,
    );

  return (
    <>
      <CertificateRow />
      <SettingRowBoolean
        title="Decrypt everything"
        description="Except built-in exclusions"
        checked={everything}
        disabled={busy}
        onChange={(on) =>
          void change(
            everythingEdit(on),
            on ? "Decrypting everything" : "Stopped decrypting everything",
            on ? "Except Apple services and apps that pin" : undefined,
          )
        }
      />
      <div className="py-4 grid gap-2">
        <div className="flex items-center text-text">
          Hosts and apps
          <span className="ml-auto text-sm text-text-subtlest">New connections</span>
        </div>
        <EntryInput
          seenRef={seenRef}
          list={list}
          disabled={busy}
          onAdd={(entry) =>
            void change(
              { add: [entry], remove: [] },
              entry.startsWith("!")
                ? `Excluding ${entrySubject(entry.slice(1))}`
                : `Decrypting ${entrySubject(entry)}`,
            )
          }
        />
        <div className="rounded-md border border-border-subtle divide-y divide-border-subtle">
          {own.length === 0 && (
            <div className="px-3 py-2 text-sm text-text-subtle">Nothing listed</div>
          )}
          {own.map((e) => (
            <EntryRow key={e.entry} entry={e} disabled={busy} onRemove={() => remove(e.entry)} />
          ))}
          {builtIns.length > 0 && <BuiltIns entries={builtIns} disabled={busy} onRemove={remove} />}
        </div>
      </div>
    </>
  );
}

/** The certificate: trusted, with Reveal for devices and tools with their own stores, or Trust */
function CertificateRow() {
  const caStatus = useRpcQuery("ca_status", {});
  const trust = useTrustCertificate();
  const trusting = useTrusting();
  const showToast = useShowToast();
  const status = caStatus.data;
  if (status == null)
    return (
      <SettingRow title="Certificate" description="Yaak Proxy CA">
        {null}
      </SettingRow>
    );
  return (
    <SettingRow title="Certificate" description="Yaak Proxy CA">
      <div className="flex items-center gap-2">
        {status.trusted ? (
          <span className="flex items-center gap-1 text-sm text-success">
            <Icon icon="badge_check" size="sm" />
            Trusted
          </span>
        ) : (
          <span className="text-sm text-text-subtle">Not trusted</span>
        )}
        {!status.trusted && canTrustHere() ? (
          <Button size="2xs" color="primary" isLoading={trusting} onClick={() => trust.mutate({})}>
            {trusting ? "Waiting for macOS" : "Trust"}
          </Button>
        ) : (
          <Button
            size="2xs"
            variant="border"
            onClick={() =>
              void revealPath(status.certPath, (message) =>
                showToast({ id: "reveal-ca", color: "danger", message }),
              )
            }
          >
            Reveal
          </Button>
        )}
      </div>
    </SettingRow>
  );
}

/** The built-in exclusions, folded into one row that opens to each, with its kind */
function BuiltIns({
  entries,
  disabled,
  onRemove,
}: {
  entries: DecryptListEntry[];
  disabled: boolean;
  onRemove: (entry: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const kinds = new Set(entries.map((e) => e.kind));
  const summary = [kinds.has("apple") ? "Apple" : null, kinds.has("pinned") ? "pinned apps" : null]
    .filter((k) => k != null)
    .join(", ");
  return (
    <>
      <button
        type="button"
        className="w-full flex items-center gap-2 h-xs pl-3 pr-2 text-sm text-text-subtle hover:bg-surface-highlight/50"
        onClick={() => setOpen(!open)}
      >
        <Icon icon={open ? "chevron_down" : "chevron_right"} size="sm" className="shrink-0" />
        {entries.length} built-in exclusions
        <span className="ml-auto text-xs text-text-subtlest">{summary}</span>
      </button>
      {open &&
        entries.map((e) => (
          <EntryRow
            key={e.entry}
            entry={e}
            disabled={disabled}
            onRemove={() => onRemove(e.entry)}
          />
        ))}
    </>
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
      <Tooltip wrap content={negated ? "Excluded" : "Decrypted"} delay={CONTROL_TOOLTIP_DELAY}>
        <Icon
          icon={negated ? "lock" : "lock_open"}
          size="sm"
          className={classNames("shrink-0", entry.builtIn ? "opacity-60" : "text-text-subtle")}
        />
      </Tooltip>
      <span className={classNames("truncate", entry.entry !== "*" && "font-mono text-xs")}>
        {entryLabel(entry.entry)}
      </span>
      {entry.builtIn && entry.kind != null && (
        <span className="shrink-0 text-2xs rounded px-1 border border-border-subtle">
          {entry.kind === "apple" ? "Apple" : "Pinned"}
        </span>
      )}
      <IconButton
        size="xs"
        icon="x"
        iconColor="secondary"
        title={`Remove ${entryLabel(entry.entry)}`}
        tooltip
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
    <Tooltip wrap content="Applies to new connections" delay={CONTROL_TOOLTIP_DELAY}>
      <div className="grid gap-1">
        <Input
          label="Add entry"
          hideLabel
          size="sm"
          stateKey={null}
          language={null}
          placeholder="Add host or app"
          extensions={extensions}
          onChange={() => setError(null)}
        />
        {error != null && <div className="text-xs text-danger">{error}</div>}
      </div>
    </Tooltip>
  );
}
