import { insertCompletionText, pickedCompletion, type Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { GenericCompletionOption } from "@yaakapp-internal/plugins";
import {
  genericCompletion,
  type GenericCompletion,
  type GenericCompletionConfig,
} from "../genericCompletion";

const protocolOptions: GenericCompletionOption[] = [
  { label: "http://", type: "constant" },
  { label: "https://", type: "constant" },
];

export function getUrlCompletionConfig(
  options: GenericCompletionOption[],
  minMatch = 3,
): GenericCompletionConfig {
  const urlOptions = [
    ...protocolOptions,
    ...options.filter(
      (option) => !protocolOptions.some((protocol) => protocol.label === option.label),
    ),
  ];
  return {
    minMatch,
    options: urlOptions.map<GenericCompletion>((option) => ({
      ...option,
      apply: applyUrlCompletion,
    })),
  };
}

export function applyUrlCompletion(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
) {
  const isProtocol = /^https?:\/\/$/.test(completion.label);
  const replaceTo = isProtocol
    ? to + (view.state.sliceDoc(to, to + 3) === "://" ? 3 : 0)
    : view.state.doc.length;

  view.dispatch({
    ...insertCompletionText(view.state, completion.label, from, replaceTo),
    annotations: pickedCompletion.of(completion),
  });
}

export const completions = genericCompletion(getUrlCompletionConfig([], 1));
