import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import type { HostEditorProps, HostInputProps } from "../EditorHost";
import { EditorHostProvider } from "../EditorHost";
import { PairEditorRow } from "../pairs/PairEditor";
import { bodyTypeLabel } from "./HttpRequestPaneView";
import { JsonBodyEditor } from "./JsonBodyEditor";
import { RequestBodyViewer } from "./RequestBodyViewer";
import { RequestMethodDropdown } from "./RequestMethodDropdown";
import { parseCookieHeaders } from "./ResponseCookies";
import {
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_JSON,
  BODY_TYPE_OTHER,
  type HttpBodyLoader,
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
