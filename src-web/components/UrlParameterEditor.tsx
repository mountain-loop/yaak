import type { HttpRequest } from '@yaakapp-internal/models';
import { useRef } from 'react';
import { useRequestEditor, useRequestEditorEvent } from '../hooks/useRequestEditor';
import type { PairEditorProps, PairEditorRef } from './core/PairEditor';
import { PairOrBulkEditor } from './core/PairOrBulkEditor';
import { VStack } from './core/Stacks';

type Props = {
  forceUpdateKey: string;
  pairs: HttpRequest['headers'];
  stateKey: PairEditorProps['stateKey'];
  onChange: (headers: HttpRequest['urlParameters']) => void;
};

export function UrlParametersEditor({ pairs, forceUpdateKey, onChange, stateKey }: Props) {
  const pairEditor = useRef<PairEditorRef>(null);
  const [{ urlParametersKey }] = useRequestEditor();

  useRequestEditorEvent(
    'request_params.focus_value',
    (name) => {
      const pairIndex = pairs.findIndex((p) => p.name === name);
      if (pairIndex >= 0) {
        pairEditor.current?.focusValue(pairIndex);
      } else {
        console.log("Couldn't find pair to focus", { name, pairs });
      }
    },
    [pairs],
  );

  return (
    <VStack className="h-full">
      <PairOrBulkEditor
        ref={pairEditor}
        forceUpdateKey={forceUpdateKey + urlParametersKey}
        nameAutocompleteVariables
        namePlaceholder="param_name"
        onChange={onChange}
        pairs={pairs}
        preferenceName="url_parameters"
        stateKey={stateKey}
        valueAutocompleteVariables
        valuePlaceholder="Value"
      />
    </VStack>
  );
}
