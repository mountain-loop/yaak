import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";
import type { HotkeyAction } from "../../hooks/useHotKey";
import { HotkeyList } from "./HotkeyList";

vi.mock("./Hotkey", () => ({
  Hotkey: ({ action }: { action: HotkeyAction }) =>
    action === "sidebar.selected.move" ? null : <span>{action}</span>,
}));

vi.mock("./HotkeyLabel", () => ({
  HotkeyLabel: ({ action }: { action: HotkeyAction }) => <span>{action}</span>,
}));

describe("HotkeyList", () => {
  test("keeps a grid cell for actions without a shortcut", () => {
    const markup = renderToStaticMarkup(
      <HotkeyList hotkeys={["sidebar.selected.move", "request.send"]} />,
    );

    expect(markup).toContain(
      '<span>sidebar.selected.move</span><div class="ml-4"></div><span>request.send</span>',
    );
  });
});
