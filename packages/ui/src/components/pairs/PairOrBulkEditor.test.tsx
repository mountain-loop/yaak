import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import type { HostInputProps } from "../EditorHost";
import { EditorHostProvider } from "../EditorHost";
import { PairOrBulkEditor } from "./PairOrBulkEditor";

function StubInput({ name, defaultValue }: HostInputProps) {
  return <div data-input={name}>{defaultValue}</div>;
}

function render(actions?: string) {
  return renderToStaticMarkup(
    <EditorHostProvider value={{ Input: StubInput }}>
      <PairOrBulkEditor
        readOnly
        preferenceName="test"
        stateKey="test"
        forceUpdateKey=""
        pairs={[{ id: "p1", enabled: true, name: "a", value: "1" }]}
        onChange={() => {}}
        actions={actions == null ? undefined : <span data-action>{actions}</span>}
      />
    </EditorHostProvider>,
  );
}

describe("PairOrBulkEditor", () => {
  test("with actions, its bulk toggle shares one actions bar with them", () => {
    const markup = render("SWITCH");
    expect(markup).toContain("group/actions");
    // The toggle, then the given actions, inside the bar
    expect(markup).toMatch(/group-hover\/actions[^>]*>.*Enable bulk edit.*SWITCH/);
  });

  test("without actions, its toggle keeps its own corner", () => {
    const markup = render();
    expect(markup).not.toContain("group/actions");
    expect(markup).toContain("Enable bulk edit");
  });
});
