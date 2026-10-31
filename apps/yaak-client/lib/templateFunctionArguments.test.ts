import { readFile } from "node:fs/promises";
import type { TemplateFunction } from "@yaakapp-internal/plugins";
import type { FnArg, Tokens } from "@yaakapp-internal/templates";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";
import {
  collectEditableArgumentValues,
  preserveUnchangedArgumentExpressions,
} from "./templateFunctionArguments";

// Use the shipped WASM parser without the browser-only `?init` loader.
let parse: (text: string) => Tokens;
beforeAll(async () => {
  const base = new URL("../../../crates/yaak-templates/pkg/", import.meta.url);
  const bindings = await import(new URL("yaak_templates_bg.js", base).href);
  const { instance } = await WebAssembly.instantiate(
    await readFile(new URL("yaak_templates_bg.wasm", base)),
    { "./yaak_templates_bg.js": bindings },
  );
  bindings.__wbg_set_wasm(instance.exports);
  (instance.exports.__wbindgen_start as () => void)();
  parse = bindings.parse_template;
});

const definition: TemplateFunction = {
  name: "timestamp.iso8601",
  args: [{ type: "text", name: "date", optional: true }],
};

function args(tokens: Tokens): FnArg[] {
  const first = tokens.tokens[0];
  if (first?.type !== "tag" || first.val.type !== "fn") throw new Error("Expected a function");
  return first.val.args;
}

function stringArg(name: string, text: string): FnArg {
  return { name, value: { type: "str", text } };
}

// Printing is an existing async RPC. Assert the exact expression handed to it and return
// its expected text, including real parser round-tripping of quoted/escaped fixtures.
function printer(text: string) {
  return vi.fn(async (tokens: Tokens) => {
    expect(tokens.tokens).toEqual(parse(text).tokens.filter((t) => t.type !== "eof"));
    return text;
  });
}

describe("editable template function arguments", () => {
  test.each([
    [
      "reported call",
      "${[timestamp.iso8601(date=timestamp.offset(expression='-1h')) ]}",
      "${[ timestamp.offset(expression='-1h') ]}",
    ],
    ["variable", "${[ timestamp.iso8601(date=date_var) ]}", "${[ date_var ]}"],
    ["dotted variable", "${[ timestamp.iso8601(date=dates.previous) ]}", "${[ dates.previous ]}"],
    [
      "nested escaping",
      String.raw`${"${["} timestamp.iso8601(date=outer(value=inner(text='it\'s \\ nested'))) ]}`,
      String.raw`${"${["} outer(value=inner(text='it\'s \\ nested')) ]}`,
    ],
  ])("loads and preserves %s on unchanged Save", async (_, source, display) => {
    const initialTokens = parse(source);
    const snapshot = structuredClone(initialTokens);
    const print = printer(display);
    const initial = await collectEditableArgumentValues(initialTokens, definition, print);
    expect(initial).toEqual({ date: display });
    expect(print).toHaveBeenCalledOnce();

    const saved = preserveUnchangedArgumentExpressions(
      [stringArg("date", display)],
      initialTokens,
      initial,
      { ...initial },
    );
    expect(saved).toEqual(args(initialTokens));
    expect(initialTokens).toEqual(snapshot);
  });

  test.each([
    String.raw`${"${["} timestamp.iso8601(date='${"${["} timestamp.offset(expression=\'-1h\') ]}') ]}`,
    "${[ timestamp.iso8601(date='${[ date_var ]}') ]}",
    "${[ timestamp.iso8601(date='${[ dates.previous ]}') ]}",
    "${[ timestamp.iso8601(date='2026-10-27T11:00:00.000Z') ]}",
  ])("leaves existing quoted arguments unchanged: %s", async (source) => {
    const initialTokens = parse(source);
    const print = vi.fn<(_: Tokens) => Promise<string>>();
    const initial = await collectEditableArgumentValues(initialTokens, definition, print);
    const value = args(initialTokens)[0]?.value;
    if (value?.type !== "str") throw new Error("Expected a string fixture");
    expect(initial).toEqual({ date: value.text });
    expect(print).not.toHaveBeenCalled();
    expect(
      preserveUnchangedArgumentExpressions(
        [stringArg("date", value.text)],
        initialTokens,
        initial,
        initial,
      ),
    ).toEqual(args(initialTokens));
  });

  test("editing a sibling preserves the original expression", async () => {
    const initialTokens = parse(
      "${[ timestamp.format(date=timestamp.offset(expression='-1h'), format='HH:mm') ]}",
    );
    const initial = await collectEditableArgumentValues(
      initialTokens,
      {
        name: "timestamp.format",
        args: [...definition.args, { type: "text", name: "format" }],
      },
      printer("${[ timestamp.offset(expression='-1h') ]}"),
    );
    const values: Record<string, string | boolean> = { ...initial, format: "yyyy-MM-dd" };
    const saved = preserveUnchangedArgumentExpressions(
      [stringArg("date", String(values.date)), stringArg("format", String(values.format))],
      initialTokens,
      initial,
      values,
    );
    expect(saved).toEqual([args(initialTokens)[0], stringArg("format", "yyyy-MM-dd")]);
  });

  test.each(["${[ timestamp.offset(expression='-2h') ]}", "2026-10-26", ""])(
    "intentional edits use the form's quoted-string convention: %s",
    async (edited) => {
      const initialTokens = parse("${[ timestamp.iso8601(date=date_var) ]}");
      const initial = await collectEditableArgumentValues(
        initialTokens,
        definition,
        printer("${[ date_var ]}"),
      );
      const changed = [stringArg("date", edited)];
      expect(
        preserveUnchangedArgumentExpressions(changed, initialTokens, initial, { date: edited }),
      ).toEqual(changed);
      // Returning the input to its original text restores the original expression type.
      expect(
        preserveUnchangedArgumentExpressions(
          [stringArg("date", String(initial.date))],
          initialTokens,
          initial,
          { ...initial },
        ),
      ).toEqual(args(initialTokens));
    },
  );

  test("does not resurrect removed or explicitly cleared expression arguments", async () => {
    const initialTokens = parse("${[ timestamp.iso8601(date=date_var) ]}");
    const initial = await collectEditableArgumentValues(
      initialTokens,
      definition,
      printer("${[ date_var ]}"),
    );
    expect(preserveUnchangedArgumentExpressions([], initialTokens, initial, {})).toEqual([]);
    const nullArg: FnArg = { name: "date", value: { type: "null" } };
    expect(
      preserveUnchangedArgumentExpressions([nullArg], initialTokens, initial, { date: "__NULL__" }),
    ).toEqual([nullArg]);
    // DynamicForm clears some inputs by leaving a key with undefined; the dialog turns it into ''.
    expect(
      preserveUnchangedArgumentExpressions([stringArg("date", "")], initialTokens, initial, {}),
    ).toEqual([stringArg("date", "")]);
    expect(
      preserveUnchangedArgumentExpressions([stringArg("date", "")], initialTokens, {}, {}),
    ).toEqual([stringArg("date", "")]);
  });

  test("keeps absence, defaults, explicit empty strings, and false distinct", async () => {
    const fn: TemplateFunction = {
      name: "test",
      args: [
        { type: "text", name: "absent" },
        { type: "text", name: "defaulted", defaultValue: "fallback" },
        { type: "text", name: "empty", defaultValue: "fallback" },
        { type: "checkbox", name: "flag", defaultValue: "true" },
        { type: "checkbox", name: "defaultFlag", defaultValue: "false" },
      ],
    };
    const initialTokens = parse("${[ test(empty='', flag=false) ]}");
    const print = vi.fn<(_: Tokens) => Promise<string>>();
    const initial = await collectEditableArgumentValues(initialTokens, fn, print);
    expect(initial).toEqual({
      defaulted: "fallback",
      empty: "",
      flag: false,
      defaultFlag: "false",
    });
    expect(print).not.toHaveBeenCalled();
    const formArgs: FnArg[] = [
      stringArg("defaulted", "fallback"),
      stringArg("empty", ""),
      { name: "flag", value: { type: "bool", value: false } },
      stringArg("defaultFlag", "false"),
    ];
    expect(preserveUnchangedArgumentExpressions(formArgs, initialTokens, initial, initial)).toEqual(
      formArgs,
    );
  });

  test("an expression overrides defaults, including inputs in a group", async () => {
    const initialTokens = parse("${[ test(date=dates.previous) ]}");
    const initial = await collectEditableArgumentValues(
      initialTokens,
      {
        name: "test",
        args: [
          { type: "h_stack", inputs: [{ type: "text", name: "date", defaultValue: "fallback" }] },
        ],
      },
      printer("${[ dates.previous ]}"),
    );
    expect(initial).toEqual({ date: "${[ dates.previous ]}" });
  });

  test("explicit null keeps the existing default and omission behavior", async () => {
    const initialTokens = parse("${[ test(defaulted=null, omitted=null) ]}");
    const print = vi.fn<(_: Tokens) => Promise<string>>();
    const initial = await collectEditableArgumentValues(
      initialTokens,
      {
        name: "test",
        args: [
          { type: "text", name: "defaulted", defaultValue: "fallback" },
          { type: "text", name: "omitted" },
        ],
      },
      print,
    );
    expect(initial).toEqual({ defaulted: "fallback" });
    expect(print).not.toHaveBeenCalled();
    expect(
      preserveUnchangedArgumentExpressions(
        [stringArg("defaulted", "fallback")],
        initialTokens,
        initial,
        initial,
      ),
    ).toEqual([stringArg("defaulted", "fallback")]);
  });

  test("keeps a deeply nested expression's AST without adding string wrappers", async () => {
    // This shape reaches the native renderer's depth limit. A quoted wrapper around
    // the date expression would exceed it, even though shallow calls render identically.
    const expression =
      "timestamp.iso8601(date=".repeat(44) + "'2026-10-26T10:20:30.000Z'" + ")".repeat(44);
    const initialTokens = parse(`\${[ timestamp.iso8601(date=${expression}) ]}`);
    const initial = await collectEditableArgumentValues(
      initialTokens,
      definition,
      printer(`\${[ ${expression} ]}`),
    );
    const saved = preserveUnchangedArgumentExpressions(
      [stringArg("date", String(initial.date))],
      initialTokens,
      initial,
      initial,
    );
    expect(saved).toEqual(args(initialTokens));
  });
});
