import type { HttpRequest } from '@yaakapp-internal/models';
import { useCallback, useRef } from 'react';
import { useRequestEditor, useRequestEditorEvent } from '../hooks/useRequestEditor';
import type { PairEditorHandle, PairEditorProps } from './core/PairEditor';
import { PairOrBulkEditor } from './core/PairOrBulkEditor';
import { VStack } from './core/Stacks';

type Props = {
  forceUpdateKey: string;
  pairs: HttpRequest['headers'];
  stateKey: PairEditorProps['stateKey'];
  onChange: (headers: HttpRequest['urlParameters']) => void;
};

export function UrlParametersEditor({ pairs, forceUpdateKey, onChange, stateKey }: Props) {
  const pairEditorRef = useRef<PairEditorHandle>(null);
  const handleInitPairEditorRef = useCallback((ref: PairEditorHandle) => {
    return (pairEditorRef.current = ref);
  }, []);

  const [{ urlParametersKey }] = useRequestEditor();

  useRequestEditorEvent(
    'request_params.focus_value',
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
