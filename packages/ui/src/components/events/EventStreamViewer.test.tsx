import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";
import { payloadText, StreamEventRow } from "./EventStreamViewer";
import type { StreamEvent } from "./streamEvents";

// The detail header's select asks the platform which OS it runs on
vi.mock("@yaakapp-internal/platform", () => ({ platform: { osType: () => "macos" } }));

const event: StreamEvent = {
  key: "3",
  direction: "sent",
  kind: "text",
  timestamp: "2026-11-06T09:30:00.250",
  size: 2048,
  preview: '{"op":1}',
};

describe("StreamEventRow", () => {
  test("without columns, draws the client's row: arrow, labels and preview", () => {
    const markup = renderToStaticMarkup(
      <StreamEventRow
        event={{ ...event, direction: "received", labels: ["7", "tick"] }}
        preview="hello"
        delta={null}
        isActive={false}
        onClick={() => {}}
      />,
    );
    expect(markup).toContain('title="Server Message"');
    expect(markup).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(markup.indexOf(">7<")).toBeLessThan(markup.indexOf(">tick<"));
    expect(markup).toContain('<span class="truncate text-xs">hello</span>');
    // No size or time without the columns asking for them
    expect(markup).not.toContain("2 KB");
  });

  test("with columns, draws direction, kind, preview, size, delta and time in order", () => {
    const markup = renderToStaticMarkup(
      <StreamEventRow
        event={event}
        preview={event.preview}
        delta={1500}
        columns={{ direction: true, kind: "Type", size: true, time: true }}
        isActive={false}
        onClick={() => {}}
      />,
    );
    expect(markup).toContain("grid-template-columns:1rem 4rem minmax(0,1fr) 4.5rem 4.5rem 6.5rem");
    expect(markup).toContain('title="Client Message"');
    const order = [">text<", "{&quot;op&quot;:1}", "2 KB", "+1.5 s"].map((s) => markup.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("an event stream's row has no direction column, and a note replaces the preview", () => {
    const markup = renderToStaticMarkup(
      <StreamEventRow
        event={{ ...event, direction: "info", note: "12 UNIMPLEMENTED", warning: true }}
        preview={null}
        delta={null}
        columns={{ kind: "Event", size: true }}
        isActive={false}
        onClick={() => {}}
      />,
    );
    expect(markup).not.toContain("Client Message");
    expect(markup).toContain('class="text-xs text-warning">12 UNIMPLEMENTED<');
  });

  test("an empty binary payload reads as no content, a non-empty one as binary", () => {
    const row = (size: number) =>
      renderToStaticMarkup(
        <StreamEventRow
          event={{ ...event, preview: null, binary: true, size }}
          preview={null}
          delta={null}
          columns={{ kind: "Type" }}
          isActive={false}
          onClick={() => {}}
        />,
      );
    expect(row(0)).toContain("No content");
    expect(row(4)).toContain("Binary");
  });
});

describe("payloadText", () => {
  test("pretty-prints JSON and leaves other text as it is", () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    expect(payloadText(bytes('{"a":[1]}'))).toEqual({
      text: '{\n  "a": [\n    1\n  ]\n}',
      language: "json",
    });
    expect(payloadText(bytes("42"))).toEqual({ text: "42", language: "text" });
    expect(payloadText(bytes("plain"))).toEqual({ text: "plain", language: "text" });
  });
});
