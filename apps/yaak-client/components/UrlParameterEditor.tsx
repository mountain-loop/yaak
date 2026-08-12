import { VStack } from "@yaakapp-internal/ui";
import { useCallback, useEffect, useRef } from "react";
import { useRequestEditor, useRequestEditorEvent } from "../hooks/useRequestEditor";
import type { EditablePair, PairEditorHandle, PairEditorProps } from "./core/PairEditor";
import { PairOrBulkEditor } from "./core/PairOrBulkEditor";

type Props = {
  forceUpdateKey: string;
  pairs: EditablePair[];
  stateKey: PairEditorProps["stateKey"];
  onChange: PairEditorProps["onChange"];
};

/** ~1s at 60fps, plenty for the tab to switch without spinning forever if it never does */
const MAX_FOCUS_ATTEMPTS = 60;

/**
 * Focus a row's value field once it's able to take focus, and return a way to give up early.
 *
 * Clicking a `:param` in the URL bar activates the Params tab first, and that only takes effect
 * once the new tab has been persisted and read back — well over a frame. Until then this editor is
 * still `display: none`, where focus doesn't stick, so keep trying until it does.
 */
function focusValueWhenReady(getEditor: () => PairEditorHandle | null, pairId: string) {
  let frame: number | null = null;
  let attemptsLeft = MAX_FOCUS_ATTEMPTS;

  const attempt = () => {
    if (getEditor()?.focusValue(pairId)) return;
    if (--attemptsLeft <= 0) return;
    frame = requestAnimationFrame(attempt);
  };

  attempt();

  return () => {
    if (frame != null) cancelAnimationFrame(frame);
  };
}

export function UrlParametersEditor({ pairs, forceUpdateKey, onChange, stateKey }: Props) {
  const pairEditorRef = useRef<PairEditorHandle>(null);
  const handleInitPairEditorRef = useCallback((ref: PairEditorHandle) => {
    pairEditorRef.current = ref;
  }, []);

  const [{ urlParametersKey }] = useRequestEditor();

  const cancelPendingFocus = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelPendingFocus.current?.(), []);

  useRequestEditorEvent(
    "request_params.focus_value",
    (name) => {
      const pair = pairs.find((p) => p.name === name);
      if (pair?.id != null) {
        cancelPendingFocus.current?.();
        cancelPendingFocus.current = focusValueWhenReady(() => pairEditorRef.current, pair.id);
      } else {
        console.log(`Couldn't find pair to focus`, { name, pairs });
      }
    },
    [pairs],
  );

  return (
    <VStack className="h-full">
      <PairOrBulkEditor
        setRef={handleInitPairEditorRef}
        allowMultilineValues
        forceUpdateKey={forceUpdateKey + urlParametersKey}
        nameAutocompleteFunctions
        nameAutocompleteVariables
        namePlaceholder="param_name"
        onChange={onChange}
        pairs={pairs}
        preferenceName="url_parameters"
        stateKey={stateKey}
        valueAutocompleteFunctions
        valueAutocompleteVariables
        valuePlaceholder="Value"
      />
    </VStack>
  );
}
