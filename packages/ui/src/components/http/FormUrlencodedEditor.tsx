import { type ReactNode, useCallback, useMemo } from "react";
import type { Pair, PairEditorProps } from "../pairs/PairEditor";
import { PairOrBulkEditor } from "../pairs/PairOrBulkEditor";
import type { HttpFormFieldView, HttpRequestBodyView } from "./types";

type Props = {
  forceUpdateKey: string;
  /** The request's id, keeping each request's editor state apart */
  requestId: string;
  form: HttpFormFieldView[] | undefined;
  onChange?: (body: HttpRequestBodyView) => void;
  /** Show the fields without a way to change them */
  readOnly?: boolean;
  /** Drawn in one bar with the bulk-edit toggle, like a view-mode switch */
  actions?: ReactNode;
};

export function FormUrlencodedEditor({
  requestId,
  form,
  forceUpdateKey,
  onChange,
  readOnly,
  actions,
}: Props) {
  const pairs = useMemo<Pair[]>(
    () =>
      (Array.isArray(form) ? form : []).map((p) => ({
        enabled: !!p.enabled,
        name: p.name || "",
        value: p.value || "",
        id: p.id,
      })),
    [form],
  );

  const handleChange = useCallback<PairEditorProps["onChange"]>(
    (pairs) =>
      onChange?.({
        form: pairs.map((p) => ({ enabled: p.enabled, name: p.name, value: p.value })),
      }),
    [onChange],
  );

  return (
    <PairOrBulkEditor
      allowMultilineValues
      preferenceName="form_urlencoded"
      valueAutocompleteFunctions
      valueAutocompleteVariables
      nameAutocompleteFunctions
      nameAutocompleteVariables
      namePlaceholder="entry_name"
      valuePlaceholder="Value"
      pairs={pairs}
      onChange={handleChange}
      readOnly={readOnly}
      actions={actions}
      forceUpdateKey={forceUpdateKey}
      stateKey={`urlencoded.${requestId}`}
    />
  );
}
