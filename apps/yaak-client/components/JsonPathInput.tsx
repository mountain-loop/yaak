import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import type { HttpResponse } from "@yaakapp-internal/models";
import { useMemo, useRef, useState } from "react";
import { rpc } from "../lib/rpc";
import { Input } from "./core/Input";
import type { InputProps } from "./core/Input";
import { jsonPathCompletion } from "./core/Editor/json/pathCompletion";
import type { JsonPathChildren, LoadJsonPathChildren } from "./core/Editor/json/pathCompletion";

type Props = Pick<InputProps, "defaultValue" | "onChange" | "forceUpdateKey" | "stateKey"> & {
  response: HttpResponse | null;
};

export function JsonPathInput({ response, ...props }: Props) {
  const client = useQueryClient();
  const [sampled, setSampled] = useState(false);
  const responseKey = response?.state === "closed" ? `${response.id}:${response.updatedAt}` : null;
  const currentResponseKey = useRef(responseKey);
  currentResponseKey.current = responseKey;
  const load = useRef<LoadJsonPathChildren>(async () => null);
  load.current = async (parent) => {
    if (!response || !responseKey) return null;
    try {
      const result = await client.fetchQuery({
        queryKey: ["json_path_children", response.id, response.updatedAt, parent],
        queryFn: () =>
          rpc<JsonPathChildren>("cmd_http_response_json_children", {
            responseId: response.id,
            parent,
          }),
        staleTime: Infinity,
        gcTime: 60_000,
        retry: false,
      });
      if (responseKey !== currentResponseKey.current) return null;
      setSampled(result.truncated);
      return result;
    } catch {
      return null;
    } // Non-JSON bodies and incomplete expressions still allow normal typing.
  };
  // The editor installs extraExtensions once. A ref keeps the response current without rebuilding
  // the input and losing focus/selection when a new response arrives.
  const extensions = useMemo(
    () => [
      autocompletion({ override: [jsonPathCompletion((parent) => load.current(parent))] }),
      EditorView.domEventHandlers({
        focus: (_event, view) => {
          startCompletion(view);
        },
      }),
    ],
    [],
  );
  return (
    <div className="min-w-0">
      <Input
        {...props}
        label="JSONPath"
        size="sm"
        placeholder="$.user.id"
        language="text"
        autocompleteFunctions={false}
        autocompleteVariables={false}
        extraExtensions={extensions}
      />
      {sampled && (
        <p className="text-xs text-text-subtle mt-1">
          Suggestions are sampled. You can enter any path.
        </p>
      )}
    </div>
  );
}
