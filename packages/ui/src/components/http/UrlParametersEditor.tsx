import type { EditablePair, PairEditorHandle, PairEditorProps } from "../pairs/PairEditor";
import { PairOrBulkEditor } from "../pairs/PairOrBulkEditor";
import { VStack } from "../Stacks";

type Props = {
  forceUpdateKey: string;
  pairs: EditablePair[];
  stateKey: PairEditorProps["stateKey"];
  onChange?: PairEditorProps["onChange"];
  /** Show the parameters without a way to change them */
  readOnly?: boolean;
  setRef?: (handle: PairEditorHandle) => void;
};

export function UrlParametersEditor({
  pairs,
  forceUpdateKey,
  onChange = ignoreChange,
  readOnly,
  setRef,
  stateKey,
}: Props) {
  return (
    <VStack className="h-full">
      <PairOrBulkEditor
        setRef={setRef}
        allowMultilineValues
        forceUpdateKey={forceUpdateKey}
        nameAutocompleteFunctions
        nameAutocompleteVariables
        namePlaceholder="param_name"
        onChange={onChange}
        pairs={pairs}
        preferenceName="url_parameters"
        readOnly={readOnly}
        stateKey={stateKey}
        valueAutocompleteFunctions
        valueAutocompleteVariables
        valuePlaceholder="Value"
      />
    </VStack>
  );
}

function ignoreChange() {}
