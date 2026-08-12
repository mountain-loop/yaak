import { VStack } from "@yaakapp-internal/ui";
import { useCallback, useRef } from "react";
import { useRequestEditor, useRequestEditorEvent } from "../hooks/useRequestEditor";
import type { EditablePair, PairEditorHandle, PairEditorProps } from "./core/PairEditor";
import { PairOrBulkEditor } from "./core/PairOrBulkEditor";

type Props = {
  forceUpdateKey: string;
  pairs: EditablePair[];
  stateKey: PairEditorProps["stateKey"];
  onChange: PairEditorProps["onChange"];
};

export function UrlParametersEditor({ pairs, forceUpdateKey, onChange, stateKey }: Props) {
  const pairEditorRef = useRef<PairEditorHandle>(null);
  const handleInitPairEditorRef = useCallback((ref: PairEditorHandle) => {
    pairEditorRef.current = ref;
  }, []);

  const [{ urlParametersKey }] = useRequestEditor();

  useRequestEditorEvent(
    "request_params.focus_value",
    (name) => {
      const pair = pairs.find((p) => p.name === name);
      if (pair?.id != null) {
        pairEditorRef.current?.focusValue(pair.id);
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
