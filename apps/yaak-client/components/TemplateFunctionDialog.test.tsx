// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Workspace } from "@yaakapp-internal/models";
import type { TemplateFunction } from "@yaakapp-internal/plugins";
import type { Tokens } from "@yaakapp-internal/templates";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vite-plus/test";
import { TemplateFunctionDialog } from "./TemplateFunctionDialog";

interface FormProps {
  data: Record<string, string | boolean>;
  onChange: (values: Record<string, string | boolean>) => void;
}

const mocks = vi.hoisted(() => ({
  parse: vi.fn<(text: string) => Tokens>(),
  print: vi.fn<(tokens: Tokens) => Promise<string>>(),
  serialize: vi.fn<(tokens: Tokens) => { data: string }>(),
  preview: vi.fn<({ template }: { template: string }) => { data: string }>(),
  form: null as FormProps | null,
  config: {
    name: "timestamp.format",
    args: [
      { type: "text", name: "date" },
      { type: "text", name: "format" },
    ],
  } as TemplateFunction,
}));

vi.mock("@yaakapp-internal/templates", () => ({ parseTemplate: mocks.parse }));
vi.mock("@yaakapp-internal/ui", () => ({
  HStack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  InlineCode: "code",
  LoadingIcon: () => null,
  useDebouncedValue: (value: string) => value,
}));
vi.mock("../hooks/useActiveWorkspace", () => ({ activeWorkspaceAtom: null }));
vi.mock("../hooks/useRenderTemplate", () => ({ useRenderTemplate: mocks.preview }));
vi.mock("../hooks/useTemplateFunctionConfig", () => ({
  useTemplateFunctionConfig: () => ({ data: mocks.config }),
}));
vi.mock("../hooks/useTemplateTokensToString", () => ({
  templateTokensToString: mocks.print,
  useTemplateTokensToString: mocks.serialize,
}));
vi.mock("../lib/dialog", () => ({ showDialog: vi.fn() }));
vi.mock("../lib/encryption", () => ({ convertTemplateToInsecure: vi.fn() }));
vi.mock("../lib/jotai", () => ({ jotaiStore: { get: vi.fn() } }));
vi.mock("../lib/setupOrConfigureEncryption", () => ({ setupOrConfigureEncryption: vi.fn() }));
vi.mock("./core/Dialog", () => ({ DialogFooter: () => <button type="submit">Save</button> }));
vi.mock("./core/IconButton", () => ({ IconButton: () => <button type="button" /> }));
vi.mock("./core/PlainInput", () => ({ PlainInput: () => null }));
vi.mock("./DynamicForm", () => ({
  DYNAMIC_FORM_NULL_ARG: "__NULL__",
  DynamicForm: (props: FormProps) => {
    mocks.form = props;
    return <input aria-label="Timestamp" readOnly value={String(props.data.date ?? "")} />;
  },
}));

beforeAll(async () => {
  const base = pathToFileURL(
    resolve(import.meta.dirname, "../../../crates/yaak-templates/pkg") + "/",
  );
  const bindings = await import(new URL("yaak_templates_bg.js", base).href);
  const { instance } = await WebAssembly.instantiate(
    await readFile(new URL("yaak_templates_bg.wasm", base)),
    { "./yaak_templates_bg.js": bindings },
  );
  bindings.__wbg_set_wasm(instance.exports);
  (instance.exports.__wbindgen_start as () => void)();
  mocks.parse.mockImplementation(bindings.parse_template);
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.form = null;
  // The transport returns an opaque string. Carry the AST as JSON so the assertions can
  // inspect what Preview and Save receive, without duplicating the backend's printer.
  mocks.serialize.mockImplementation((tokens) => ({ data: JSON.stringify(tokens) }));
  mocks.preview.mockImplementation(({ template }) => ({ data: template }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function functionValue(tokens: Tokens) {
  const first = tokens.tokens[0];
  if (first?.type !== "tag" || first.val.type !== "fn") throw new Error("Expected function");
  return first.val;
}

test.each([
  ["timestamp.offset(expression='-1h')", "${[ timestamp.offset(expression='-1h') ]}"],
  ["date_var", "${[ date_var ]}"],
  ["dates.previous", "${[ dates.previous ]}"],
  ["'${[ date_var ]}'", "${[ date_var ]}"],
])("Preview and Save preserve %s until that input changes", async (expression, display) => {
  const initialTokens = mocks.parse(`\${[ timestamp.format(date=${expression}, format='HH:mm') ]}`);
  const originalDate = functionValue(initialTokens).args[0];
  const saved = vi.fn<(value: string) => void>();
  mocks.print.mockResolvedValue(display);

  await act(async () =>
    root.render(
      <TemplateFunctionDialog
        templateFunction={mocks.config}
        initialTokens={initialTokens}
        model={{ id: "wk_test" } as Workspace}
        onChange={saved}
        hide={() => {}}
      />,
    ),
  );
  expect(host.querySelector<HTMLInputElement>("input")?.value).toBe(display);

  async function submit() {
    const form = host.querySelector("form");
    if (form == null) throw new Error("Dialog did not initialize");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const value = saved.mock.calls.at(-1)?.[0];
    expect(value).toBe(mocks.preview.mock.calls.at(-1)?.[0].template);
    return functionValue(JSON.parse(value ?? "null") as Tokens).args;
  }

  expect((await submit())[0]).toEqual(originalDate);
  await act(async () => mocks.form?.onChange({ ...mocks.form.data, format: "yyyy" }));
  expect(await submit()).toEqual([
    originalDate,
    { name: "format", value: { type: "str", text: "yyyy" } },
  ]);

  const edited = "${[ timestamp.offset(expression='-2h') ]}";
  await act(async () => mocks.form?.onChange({ ...mocks.form.data, date: edited }));
  expect((await submit())[0]).toEqual({ name: "date", value: { type: "str", text: edited } });
  await act(async () => mocks.form?.onChange({ ...mocks.form.data, date: "" }));
  expect((await submit())[0]).toEqual({ name: "date", value: { type: "str", text: "" } });
});
