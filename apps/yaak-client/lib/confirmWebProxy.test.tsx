import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { DialogInstance } from "../components/Dialogs";

const mocks = vi.hoisted(() => ({
  platform: { httpProxyUrl: "https://web.yaak.app" },
  showDialog: vi.fn<(dialog: DialogInstance) => void>(),
}));

vi.mock("@yaakapp-internal/platform", () => ({ platform: mocks.platform }));
vi.mock("./appInfo", () => ({ appInfo: { identifier: "app.yaak.web" } }));
vi.mock("./dialog", () => ({ showDialog: mocks.showDialog }));
vi.mock("../hooks/useHotKey", () => ({
  useHotKey: vi.fn(),
  useFormattedHotkey: () => null,
}));

describe("proxy consent disclosure", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", { getItem: () => null });
  });

  afterEach(() => vi.unstubAllGlobals());

  test.each([
    ["Yaak-hosted", "https://web.yaak.app"],
    ["self-hosted", "https://yaak.example.com"],
    ["local", "http://localhost:8080"],
    ["split deployment", "https://send.example.com/relay"],
  ])("identifies the %s proxy and requires an explicit decision", async (_, proxyUrl) => {
    mocks.platform.httpProxyUrl = proxyUrl;
    const { confirmWebProxy } = await import("./confirmWebProxy");
    void confirmWebProxy();

    const dialog = mocks.showDialog.mock.calls[0]?.[0];
    expect(dialog).toMatchObject({
      id: "web-proxy-consent",
      title: "Requests in Yaak Web use a proxy",
      size: "sm",
      disableClose: true,
    });
    if (dialog == null) throw new Error("Expected the proxy consent dialog");

    const disclosure = renderToStaticMarkup(<>{dialog.description}</>);
    expect(disclosure).toContain(`>${proxyUrl}</code>`);
    expect(disclosure).toMatch(/request and response data/i);
    expect(disclosure).toContain("credentials");
    expect(disclosure).toContain("server shown below");
    expect(disclosure).not.toContain("Yaak’s servers");
    expect(disclosure).toContain(
      'href="https://yaak.app/docs/getting-started/web-proxy?ref=app.yaak.web"',
    );
    expect(disclosure).toContain('target="_blank"');
    expect(disclosure).toContain("how the proxy works");

    const Actions = dialog.render;
    const actions = renderToStaticMarkup(<Actions hide={vi.fn()} />);
    expect(actions).toMatch(/<button[^>]*type="submit"/);
    expect(actions).toContain(">Send via Proxy<");
    expect(actions).toContain(">Cancel<");
  });
});
