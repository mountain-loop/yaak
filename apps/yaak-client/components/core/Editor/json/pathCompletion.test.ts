import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";
import { jsonPathCompletion, jsonPathCompletionTarget } from "./pathCompletion";
import type { JsonPathChildren } from "./pathCompletion";

const root: JsonPathChildren = {
  children: [
    { label: "users", selector: ".users", kind: "array" },
    { label: "total", selector: ".total", kind: "number" },
    { label: "a.b", selector: '["a.b"]', kind: "text" },
    { label: "a,b", selector: '["a,b"]', kind: "text" },
  ],
  truncated: false,
};
function context(text: string, explicit = false, pos = text.length) {
  return new CompletionContext(EditorState.create({ doc: text }), pos, explicit);
}

describe("progressive JSONPath completion", () => {
  it.each([
    ["", "$", ""],
    ["$", "$", ""],
    ["$.", "$", "."],
    ["us", "$", "us"],
    ["users.na", "$.users", ".na"],
    ["$.users[", "$.users", "["],
    ["$.users[0].na", "$.users[0]", ".na"],
    ["$.users[*].", "$.users[*]", "."],
    ['$["a.b"].', '$["a.b"]', "."],
    ['$["a.b', "$", '["a.b'],
    ["$['a.b", "$", "['a.b"],
    ['$["a,b', "$", '["a,b'],
    ['$.users[?(@.name == "a.b")].', '$.users[?(@.name == "a.b")]', "."],
  ])("finds the next level in %s", (text, parent, fragment) => {
    expect(jsonPathCompletionTarget(text)).toEqual({ parent, fragment });
  });

  it("loads only the parent, filters the typed prefix, and inserts a complete escaped path", async () => {
    const load = vi.fn(async () => root);
    const complete = jsonPathCompletion(load);
    const result = await complete(context("us"));
    expect(load).toHaveBeenCalledExactlyOnceWith("$");
    expect(result?.options.map((o) => o.label)).toEqual(["users"]);
    const quoted = await complete(context('$["a.b'));
    const option = quoted!.options[0]!;
    const dispatch = vi.fn();
    expect(option.label).toBe("a.b");
    if (typeof option.apply !== "function") throw new Error("Expected a completion function");
    option.apply({ dispatch } as unknown as EditorView, option, 0, 6);
    expect(dispatch.mock.calls[0]?.[0].changes).toEqual({ from: 0, to: 6, insert: '$["a.b"]' });
    expect((await complete(context("$['a.b")))?.options.map((o) => o.label)).toEqual(["a.b"]);
  });

  it("explores a completed container without turning the path into an invalid draft", async () => {
    const array: JsonPathChildren = {
      children: [
        { label: "[*]", selector: "[*]", kind: "all items" },
        { label: "[0]", selector: "[0]", kind: "object" },
      ],
      truncated: false,
    };
    const load = vi.fn(async (parent: string) => (parent === "$.users" ? array : root));
    const result = await jsonPathCompletion(load)(context("$.users", true));
    expect(load).toHaveBeenCalledExactlyOnceWith("$.users");
    expect(result?.options.map((o) => o.label)).toEqual(["[*]", "[0]"]);
    expect(
      (await jsonPathCompletion(load)(context("$.users[0")))?.options.map((o) => o.label),
    ).toEqual(["[0]"]);
  });

  it("does not suggest descendants at the root or duplicate the current scalar path", async () => {
    const load = vi.fn(async (parent: string) =>
      parent === "$" ? root : { children: [], truncated: false },
    );
    const result = await jsonPathCompletion(load)(context(""));
    expect(result?.options.map((o) => o.label)).toEqual(["users", "total", "a.b", "a,b"]);
    expect(await jsonPathCompletion(load)(context("$.total", true))).toBeNull();
  });

  it("leaves complex expressions, mid-path editing, unavailable data, and stale results alone", async () => {
    const load = vi.fn(async () => root);
    expect(await jsonPathCompletion(load)(context("$.users[?(@.na"))).toBeNull();
    expect(await jsonPathCompletion(load)(context("$..na"))).toBeNull();
    expect(await jsonPathCompletion(load)(context("$.users[0].name", false, 5))).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(await jsonPathCompletion(async () => null)(context("$"))).toBeNull();
    const stale = context("$.");
    Object.defineProperty(stale, "aborted", { get: () => true });
    expect(await jsonPathCompletion(load)(stale)).toBeNull();
  });
});
