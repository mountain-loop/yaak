import { Icon, IconButton, PlainInput } from "@yaakapp-internal/ui";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import { exportHar } from "../lib/flowActions";
import { searchTerms } from "../lib/search";
import { activeQueryAtom, searchTermsAtom } from "../lib/store";
import { useShowToast } from "../lib/toast";

/** How long typing settles before the search runs */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Searches every flow in the database by URL, method, status and content type, within the
 * sidebar's selection. ⌘F focuses it and Escape clears it.
 */
export const SearchBar = memo(function SearchBar() {
  const [text, setText] = useState("");
  const setTerms = useSetAtom(searchTermsAtom);
  const query = useAtomValue(activeQueryAtom);
  const showToast = useShowToast();
  // PlainInput hands back its <input> as the ref
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped to empty the field, which only takes a value from outside when this changes
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setTerms(searchTerms(text)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, setTerms]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const clear = () => {
    setText("");
    setTerms(null);
    setResetKey((k) => k + 1);
  };

  return (
    <div className="flex items-center gap-1.5 px-3 pb-1.5">
      <div className="flex-1 min-w-0">
        <PlainInput
          ref={inputRef}
          label="Search flows"
          hideLabel
          size="xs"
          placeholder="Search flows by URL, method, status or type"
          defaultValue={text}
          forceUpdateKey={String(resetKey)}
          onChange={setText}
          onKeyDownCapture={(e) => {
            if (e.key === "Escape" && text !== "") {
              e.stopPropagation();
              clear();
            }
          }}
          leftSlot={
            <Icon icon="search" size="sm" className="ml-2 mr-2.5 self-center text-text-subtlest" />
          }
          rightSlot={
            text === "" ? (
              <kbd className="self-center mr-2 px-1 rounded-sm border border-border-subtle font-sans text-2xs text-text-subtlest">
                ⌘F
              </kbd>
            ) : (
              <IconButton
                size="xs"
                icon="x"
                title="Clear search"
                iconColor="secondary"
                className="self-center"
                onClick={() => {
                  clear();
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              />
            )
          }
        />
      </div>
      <IconButton
        size="xs"
        icon="download"
        iconColor="secondary"
        title={query == null ? "Export every flow as HAR" : "Export the flows shown as HAR"}
        onClick={async () => {
          try {
            const written = await exportHar(query == null ? {} : { filter: query }, "flows.har");
            if (written != null) {
              showToast({
                message:
                  written === 1 ? "Exported 1 flow as HAR" : `Exported ${written} flows as HAR`,
              });
            }
          } catch (err) {
            showToast({ message: `Failed to export HAR: ${String(err)}`, color: "danger" });
          }
        }}
      />
    </div>
  );
});
