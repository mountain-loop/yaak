import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";
import type { FlowBodyData } from "../lib/flowViews";
import { FlowRequestBody } from "./FlowRequestBody";

// The package's index reaches for the window as it loads; these three are all this renders.
vi.mock("@yaakapp-internal/ui", () => ({
  Banner: ({ children, color }: { children: ReactNode; color?: string }) => (
    <div data-banner={color}>{children}</div>
  ),
  EmptyStateText: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LoadingIcon: () => <span>LOADING</span>,
  CONTROL_TOOLTIP_DELAY: 0,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const data = (truncated = false): FlowBodyData => ({
  bytes: new TextEncoder().encode('{"a":1}'),
  truncated,
  storedSize: 7,
});

function render(body: Parameters<typeof FlowRequestBody>[0]["body"]) {
  return renderToStaticMarkup(
    <FlowRequestBody body={body} viewer={<div>EDITOR</div>} requestSize={2048} />,
  );
}

describe("FlowRequestBody", () => {
  test("a body that failed to load says why, not that there is none", () => {
    const html = render({ data: undefined, isLoading: false, error: new Error("Key unavailable") });
    expect(html).toContain('data-banner="danger"');
    expect(html).toContain("Key unavailable");
    expect(html).not.toContain("EDITOR");
  });

  test("shows it is loading while the body is read", () => {
    const html = render({ data: undefined, isLoading: true, error: null });
    expect(html).not.toContain("EDITOR");
    expect(html).toContain("LOADING");
  });

  test("the viewer once loaded", () => {
    expect(render({ data: data(), isLoading: false, error: null })).toContain("EDITOR");
  });

  test("a cut body says how much was kept", () => {
    const html = render({ data: data(true), isLoading: false, error: null });
    expect(html).toContain("EDITOR");
    expect(html).toContain('data-banner="notice"');
    expect(html).toContain("kept");
  });
});
