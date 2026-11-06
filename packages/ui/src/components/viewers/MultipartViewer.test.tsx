import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";
import {
  GMAIL_BATCH_BODY,
  GMAIL_BATCH_BOUNDARY,
  GMAIL_BATCH_CONTENT_TYPE,
} from "../../lib/multipart.fixtures";
import { MultipartViewer } from "./MultipartViewer";

// Stand-ins that show which viewer a part went to, without the editor or the tab machinery
vi.mock("./TextViewer", () => ({
  TextViewer: ({ text, language }: { text: string; language?: string }) => (
    <pre data-viewer="text" data-language={language}>
      {text}
    </pre>
  ),
}));
vi.mock("./HexdumpViewer", () => ({
  HexdumpViewer: ({ data }: { data: Uint8Array }) => (
    <pre data-viewer="hexdump">{data.length} bytes</pre>
  ),
}));
vi.mock("../tabs/Tabs", () => ({
  Tabs: ({ tabs, children }: { tabs: { label: string }[]; children: ReactNode }) => (
    <div>
      {tabs.map((t) => (
        <button key={t.label} type="button">
          {t.label}
        </button>
      ))}
      {children}
    </div>
  ),
  TabContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("../HeadersTable", () => ({
  HeadersTable: ({ headers }: { headers: { name: string; value: string }[] }) => (
    <dl>
      {headers.map((h) => (
        <dt key={h.name + h.value}>
          {h.name}: {h.value}
        </dt>
      ))}
    </dl>
  ),
}));

const bytes = (s: string) => new TextEncoder().encode(s);

describe("MultipartViewer", () => {
  test("renders Gmail's batch response as a nested HTTP response", () => {
    const markup = renderToStaticMarkup(
      <MultipartViewer
        data={bytes(GMAIL_BATCH_BODY)}
        boundary={GMAIL_BATCH_CONTENT_TYPE.split("boundary=")[1]!}
      />,
    );
    expect(markup).not.toContain("Failed to parse");
    expect(markup).toContain(">response-gtlr_43499</button>");
    expect(markup).toContain("200");
    expect(markup).toContain("OK");
    expect(markup).toContain("Vary: X-Origin");
    expect(markup).toContain('data-viewer="text" data-language="json"');
    expect(markup).toContain("&quot;messagesTotal&quot;: 23545");
    expect(markup).not.toContain(GMAIL_BATCH_BOUNDARY);
  });

  test("renders a multipart part recursively", () => {
    const body = [
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/plain",
      "",
      "deep",
      "--inner--",
      "--outer--",
    ].join("\r\n");
    const markup = renderToStaticMarkup(<MultipartViewer data={bytes(body)} boundary="outer" />);
    expect(markup).toContain('data-viewer="text"');
    expect(markup).toContain(">deep</pre>");
    expect(markup).not.toContain("--inner");
  });

  test("shows a binary part as a hexdump", () => {
    const head = bytes("--b\r\nContent-Type: application/octet-stream\r\n\r\n");
    const tail = bytes("\r\n--b--");
    const data = new Uint8Array([...head, 0x00, 0x01, 0xff, 0xfe, ...tail]);
    const markup = renderToStaticMarkup(<MultipartViewer data={data} boundary="b" />);
    expect(markup).toContain('data-viewer="hexdump">4 bytes');
  });

  test("notes a body cut off before its closing delimiter", () => {
    const markup = renderToStaticMarkup(
      <MultipartViewer data={bytes("preamble\r\n--b\r\n\r\npartial")} boundary="b" />,
    );
    expect(markup).toContain("ends without its closing boundary");
    expect(markup).toContain(">partial</pre>");
  });
});
