import { useCallback, useMemo } from "react";
import type { Pair, PairEditorProps } from "../pairs/PairEditor";
import { PairEditor } from "../pairs/PairEditor";
import type { HttpFormFieldView, HttpRequestBodyView } from "./types";

type Props = {
  forceUpdateKey: string;
  /** The request's id, keeping each request's editor state apart */
  requestId: string;
  form: HttpFormFieldView[] | undefined;
  onChange?: (body: HttpRequestBodyView) => void;
  /** Show the fields without a way to change them */
  readOnly?: boolean;
};

export function FormMultipartEditor({
  requestId,
  form,
  forceUpdateKey,
  onChange,
  readOnly,
}: Props) {
  const pairs = useMemo<Pair[]>(
    () =>
      (Array.isArray(form) ? form : []).map((p) => ({
        enabled: p.enabled,
        name: p.name,
        value: (p.file ?? p.value) as string,
        contentType: p.contentType,
        filename: p.filename,
        isFile: !!p.file,
        id: p.id,
      })),
    [form],
  );

  const handleChange = useCallback<PairEditorProps["onChange"]>(
    (pairs) =>
      onChange?.({
        form: pairs.map((p) => ({
          enabled: p.enabled,
          name: p.name,
          contentType: p.contentType,
          filename: p.filename,
          file: p.isFile ? p.value : undefined,
          value: p.isFile ? undefined : p.value,
          id: p.id,
        })),
      }),
    [onChange],
  );

  return (
    <PairEditor
      valueAutocompleteFunctions
      valueAutocompleteVariables
      nameAutocompleteVariables
      nameAutocompleteFunctions
      allowFileValues
      allowMultilineValues
      pairs={pairs}
      onChange={handleChange}
      readOnly={readOnly}
      forceUpdateKey={forceUpdateKey}
      stateKey={`multipart.${requestId}`}
    />
  );
}
