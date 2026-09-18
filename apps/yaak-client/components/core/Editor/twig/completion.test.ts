/* oxlint-disable no-template-curly-in-string */
import { CompletionContext } from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vite-plus/test";
import { singleLineExtensions } from "../singleLine";
import { twigCompletion, type TwigCompletionOption } from "./completion";
import { parser } from "./twig";

const options: TwigCompletionOption[] = [
  { name: "someVar", label: "someVar", type: "variable", value: "value", onClick: () => {} },
  { name: "uuid.v4", label: "uuid.v4", type: "function", args: [], value: null, onClick: () => {} },
];
const source = twigCompletion({ options });

// Both keyboard acceptance and clicking a suggestion invoke Completion.apply.
function complete(input: string, label: string, extensions: Extension = []) {
  const cursor = input.indexOf("|");
  if (cursor < 0) throw new Error("Missing cursor marker");
  let state = EditorState.create({
    doc: input.slice(0, cursor) + input.slice(cursor + 1),
    selection: { anchor: cursor },
    extensions,
  });
  const result = source(new CompletionContext(state, cursor, false));
  const completion = result?.options.find((option) => option.label === label);
  expect(completion).toBeDefined();
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as EditorView;
  if (typeof completion?.apply !== "function" || !result) throw new Error("Missing apply");
  completion.apply(view, completion, result.from, cursor);
  return state;
}

function expectValidTag(state: EditorState, expected: string) {
  expect(state.doc.toString()).toBe(expected);
  const tags: string[] = [];
  parser.parse(expected).iterate({
    enter(node) {
      expect(node.type.isError).toBe(false);
      if (node.name === "Tag") tags.push(expected.slice(node.from, node.to));
    },
  });
  expect(tags).toHaveLength(1);
}

describe("twig completion", () => {
  test.each(["${[\nsome|", "${[ \n\n\tsome|", "${[\nsome|\n ]}", "${[\n |"])(
    "completes across multiline whitespace: %s",
    (input) => expectValidTag(complete(input, "someVar"), "${[ someVar ]}"),
  );

  test.each(["${[\nuuid.v|", "${[\n uuid.v|()\n ]}"])(
    "completes a function across multiline whitespace: %s",
    (input) => expectValidTag(complete(input, "uuid.v4"), "${[ uuid.v4() ]}"),
  );

  test("preserves surrounding lines and literal pipes", () => {
    expect(complete("before\n${[\nsome|\n]}\na | b", "someVar").doc.toString()).toBe(
      "before\n${[ someVar ]}\na | b",
    );
  });

  test("does not search past non-whitespace for an opener or closer", () => {
    expect(complete("prefix\nsome|\nother ]}", "someVar").doc.toString()).toBe(
      "prefix\n${[ someVar ]}\nother ]}",
    );
    expect(complete("${[some|\nother ]}", "someVar").doc.toString()).toBe(
      "${[ someVar ]}\nother ]}",
    );
  });

  test.each(["${[|", "${[ |", "${[  |"])(
    "offers completion immediately after a template opener: %s",
    (input) => {
      expectValidTag(complete(input, "someVar"), "${[ someVar ]}");
    },
  );

  test.each(["$", "{", "${", '{"value": "'])(
    "does not automatically offer empty-name completions after %s",
    (doc) => {
      const state = EditorState.create({ doc });
      expect(source(new CompletionContext(state, doc.length, false))).toBeNull();
    },
  );

  test.each(["uuid|", "${[uuid|", "${[ uuid| ]}"])(
    "completes a namespace before wrapping the final function: %s",
    (input) => {
      const namespace = complete(input, "uuid.*");
      expect(namespace.doc.toString()).toBe(input.replace("uuid|", "uuid."));
      const cursor = namespace.selection.main.head;
      const next = namespace.sliceDoc(0, cursor) + "|" + namespace.sliceDoc(cursor);
      expectValidTag(complete(next, "uuid.v4"), "${[ uuid.v4() ]}");
    },
  );

  test.each(["some|", "${[some|", "${[ some|", "${[  someVar|", "${[\tsome|"])(
    "completes a variable in a single-line value: %s",
    (input) => {
      const state = complete(input, "someVar", singleLineExtensions());
      expectValidTag(state, "${[ someVar ]}");
      expect(state.selection.main.head).toBe(state.doc.length);
    },
  );

  test.each(["${[some|]}", "${[ some| ]}", "${[someVar|]}"])(
    "reuses closing delimiters: %s",
    (input) => {
      expectValidTag(complete(input, "someVar"), "${[ someVar ]}");
    },
  );

  test.each(["uuid.v|", "${[uuid.v|", "${[ uuid.v| ]}", "${[uuid.v|()]}"])(
    "completes a function: %s",
    (input) => {
      expectValidTag(complete(input, "uuid.v4"), "${[ uuid.v4() ]}");
    },
  );

  test("preserves surrounding JSON and its closing punctuation", () => {
    expectValidTag(
      complete('{"value":"${[some|","other":1}', "someVar", json()),
      '{"value":"${[ someVar ]}","other":1}',
    );
  });

  test("preserves surrounding text and other complete tags", () => {
    expect(complete("${[ someVar ]} ${[some|]} trailing", "someVar").doc.toString()).toBe(
      "${[ someVar ]} ${[ someVar ]} trailing",
    );
  });

  test("does not consume closing punctuation without a template opener", () => {
    expect(complete("[some|]}", "someVar").doc.toString()).toBe("[${[ someVar ]}]}");
  });

  test("invalidates cached suggestions when typing delimiters or a namespace separator", () => {
    const state = EditorState.create({ doc: "some" });
    const result = source(new CompletionContext(state, 4, false));
    expect(result?.validFor).toBeInstanceOf(RegExp);
    const validFor = result?.validFor as RegExp;
    expect(validFor.test("someVar")).toBe(true);
    expect(validFor.test("some ${[some")).toBe(false);
    expect(validFor.test("uuid.")).toBe(false);
  });
});
