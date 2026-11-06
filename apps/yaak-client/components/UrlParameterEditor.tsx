import {
  type EditablePair,
  type PairEditorHandle,
  type PairEditorProps,
  UrlParametersEditor as BaseUrlParametersEditor,
} from "@yaakapp-internal/ui";
import { useCallback, useRef } from "react";
import { useRequestEditor, useRequestEditorEvent } from "../hooks/useRequestEditor";

type Props = {
  forceUpdateKey: string;
  pairs: EditablePair[];
  stateKey: PairEditorProps["stateKey"];
  onChange: PairEditorProps["onChange"];
};

/** The shared parameters editor, wired to the request editor's focus events */
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
    <BaseUrlParametersEditor
      setRef={handleInitPairEditorRef}
      forceUpdateKey={forceUpdateKey + urlParametersKey}
      onChange={onChange}
      pairs={pairs}
      stateKey={stateKey}
    />
  );
}
