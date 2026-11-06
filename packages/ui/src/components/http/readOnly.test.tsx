import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import type { HostEditorProps, HostInputProps, SelectFileProps } from "../EditorHost";
import { EditorHostProvider } from "../EditorHost";
import { PairEditorRow } from "../pairs/PairEditor";
import { bodyTypeLabel } from "./HttpRequestPaneView";
import { ResponseStatusLine } from "./HttpResponsePaneView";
import { JsonBodyEditor } from "./JsonBodyEditor";
import { RequestBodyViewer } from "./RequestBodyViewer";
import { HTMLOrTextViewer } from "./ResponseBodyViewer";
import { RequestMethodDropdown } from "./RequestMethodDropdown";
import { parseCookieHeaders } from "./ResponseCookies";
import {
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_JSON,
  BODY_TYPE_OTHER,
  type HttpBodyLoader,
  type HttpResponseView,
} from "./types";
import { UrlBar } from "./UrlBar";

// Stand-ins for the host's editors that show what they were given
function StubInput({ name, defaultValue, readOnly, rightSlot, leftSlot }: HostInputProps) {
  return (
    <div data-input={name} data-readonly={String(!!readOnly)}>
      {leftSlot}
      {defaultValue}
      {rightSlot}
    </div>
  );
}

function StubEditor({ defaultValue, readOnly, actions }: HostEditorProps) {
  return (
    <div data-editor data-readonly={String(!!readOnly)}>
      {defaultValue}
      {actions}
    </div>
  );
}

function StubSelectFile({ filePath }: SelectFileProps) {
  return (
    <button type="button" data-picker>
      {filePath}
    </button>
  );
}

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <EditorHostProvider value={{ Input: StubInput, Editor: StubEditor }}>
      {node}
    </EditorHostProvider>,
  );
}

describe("read-only modes", () => {
  test("a pair row shows its fields read-only, with no drag handle or row menu", () => {
    const markup = render(
      <PairEditorRow
        readOnly
        index={0}
        stateKey="test"
        pair={{ id: "p1", enabled: true, name: "Accept", value: "*/*" }}
      />,
    );
    expect(markup).toContain('data-input="name[0]" data-readonly="true"');
    expect(markup).toContain('data-input="value[0]" data-readonly="true"');
    expect(markup).not.toContain("More actions");
    expect(markup).toMatch(/<input[^>]*disabled/);
  });

  test("a read-only file value shows as text, not a file picker", () => {
    const pair = {
      id: "p1",
      enabled: true,
      name: "avatar",
      value: "/Users/me/avatar.png",
      isFile: true,
    };
    const host = { Input: StubInput, Editor: StubEditor, SelectFile: StubSelectFile };
    const readOnly = renderToStaticMarkup(
      <EditorHostProvider value={host}>
        <PairEditorRow readOnly allowFileValues index={0} stateKey="test" pair={pair} />
      </EditorHostProvider>,
    );
    expect(readOnly).not.toContain("data-picker");
    expect(readOnly).toContain("data-file-value");
    expect(readOnly).toContain("/Users/me/avatar.png");

    const editable = renderToStaticMarkup(
      <EditorHostProvider value={host}>
        <PairEditorRow allowFileValues index={0} stateKey="test" pair={pair} />
      </EditorHostProvider>,
    );
    expect(editable).toContain("data-picker");
  });

  test("an editable pair row keeps its row menu", () => {
    const markup = render(
      <PairEditorRow
        index={0}
        stateKey="test"
        pair={{ id: "p1", enabled: true, name: "Accept", value: "*/*" }}
      />,
    );
    expect(markup).toContain('data-input="name[0]" data-readonly="false"');
    expect(markup).toContain("More actions");
  });

  test("the URL bar has no send button when read-only", () => {
    const readOnly = render(
      <UrlBar url="https://yaak.app" placeholder="" forceUpdateKey="" stateKey={null} readOnly />,
    );
    expect(readOnly).toContain('data-input="url" data-readonly="true"');
    expect(readOnly).not.toContain("Send Request");

    const editable = render(
      <UrlBar url="https://yaak.app" placeholder="" forceUpdateKey="" stateKey={null} />,
    );
    expect(editable).toContain("Send Request");
  });

  test("the method shows without a menu when read-only", () => {
    const readOnly = render(<RequestMethodDropdown method="POST" readOnly />);
    const editable = render(<RequestMethodDropdown method="POST" onChange={() => {}} />);
    expect(readOnly).toContain("POST");
    expect(readOnly).not.toEqual(editable);
  });

  test("a read-only JSON body has no settings menu", () => {
    const props = {
      forceUpdateKey: "",
      heightMode: "auto" as const,
      requestId: "r1",
      text: '{"a":1}',
      sendJsonComments: false,
      noticeStorageKey: "w1",
    };
    const readOnly = render(<JsonBodyEditor {...props} readOnly />);
    expect(readOnly).toContain('data-readonly="true"');
    expect(readOnly).not.toContain("JSON Settings");

    const editable = render(<JsonBodyEditor {...props} onChange={() => {}} />);
    expect(editable).toContain("JSON Settings");
  });
});

describe("RequestBodyViewer", () => {
  // A captured body that isn't valid UTF-8 has bytes but no text
  const binary: HttpBodyLoader = {
    useText: () => ({ data: null, isLoading: false, error: null }),
    useBytes: () => ({ data: new Uint8Array([0x89, 0x50, 0xff]), isLoading: false, error: null }),
    useUrl: () => ({ data: null, isLoading: false, error: null }),
  };

  test("shows a binary body instead of calling it empty", () => {
    const markup = render(
      <RequestBodyViewer id="b1" contentType="application/octet-stream" body={binary} />,
    );
    expect(markup).not.toContain("No request body");
    expect(markup).toContain("Binary body, 3");
  });

  test("hands a binary image to the image viewer", () => {
    const markup = render(<RequestBodyViewer id="b2" contentType="image/png" body={binary} />);
    expect(markup).not.toContain("No request body");
    expect(markup).not.toContain("Binary body");
  });
});

describe("HTMLOrTextViewer", () => {
  const response = {
    id: "rs_1",
    ownerId: "rq_1",
    state: "closed",
    status: 200,
    statusReason: "OK",
    url: "https://yaak.app",
    headers: [],
    requestHeaders: [],
    contentType: "application/octet-stream",
    contentLength: 3,
    contentLengthCompressed: null,
    requestContentLength: 0,
    startedAt: "2026-11-04T22:10:00Z",
    elapsedMs: 1,
    elapsedHeadersMs: 1,
    elapsedDnsMs: 0,
    error: null,
    remoteAddr: null,
    version: null,
    cookieHeaders: { sent: [], received: [] },
  } satisfies HttpResponseView;

  function loader(bytes: Uint8Array): HttpBodyLoader {
    return {
      useText: () => ({ data: null, isLoading: false, error: null }),
      useBytes: () => ({ data: bytes, isLoading: false, error: null }),
      useUrl: () => ({ data: null, isLoading: false, error: null }),
    };
  }

  test("tells a binary response from an empty one", () => {
    const binary = render(
      <HTMLOrTextViewer response={response} body={loader(new Uint8Array([0xff, 0, 1]))} pretty />,
    );
    expect(binary).toContain("Binary body, 3");

    const empty = render(
      <HTMLOrTextViewer response={response} body={loader(new Uint8Array())} pretty />,
    );
    expect(empty).toContain("Empty response");
  });

  test("the status line keeps its height without the client's history button", () => {
    // The client's button sets the line's height; without it, the line would hug the card's top
    const markup = render(<ResponseStatusLine response={response} />);
    expect(markup).toContain("min-h-[calc(var(--height-sm)+0.25rem)]");
  });
});

describe("bodyTypeLabel", () => {
  test("names a body by its type", () => {
    expect(bodyTypeLabel(BODY_TYPE_JSON, "application/json")).toBe("JSON");
    expect(bodyTypeLabel(BODY_TYPE_FORM_URLENCODED, null)).toBe("Url Encoded");
    expect(bodyTypeLabel(BODY_TYPE_OTHER, "text/markdown")).toBe("Markdown");
    expect(bodyTypeLabel(null, null)).toBe("Body");
  });
});

describe("parseCookieHeaders", () => {
  test("splits sent cookies and parses received ones, the latest of a name winning", () => {
    const { sentCookies, receivedCookies } = parseCookieHeaders({
      sent: ["a=1; b=2", "a=3"],
      received: ["s=x; Path=/; HttpOnly", "gone=; Max-Age=0"],
    });
    expect(sentCookies).toEqual([
      { name: "a", value: "3" },
      { name: "b", value: "2" },
    ]);
    expect(receivedCookies[0]).toMatchObject({ name: "s", value: "x", path: "/", httpOnly: true });
    expect(receivedCookies[1]).toMatchObject({ name: "gone", isDeleted: true });
  });
});
