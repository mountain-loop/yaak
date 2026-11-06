import { describe, expect, test } from "vite-plus/test";
import {
  boundaryFromContentType,
  headerValue,
  isProbablyBinary,
  normalizeBoundary,
  parseHttpMessage,
  parseMultipart,
} from "./multipart";
import {
  GMAIL_BATCH_BODY,
  GMAIL_BATCH_BOUNDARY,
  GMAIL_BATCH_CONTENT_TYPE,
} from "./multipart.fixtures";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (s: string) => encoder.encode(s);
const text = (b: Uint8Array) => decoder.decode(b);

describe("parseMultipart", () => {
  test("parses Gmail's batch response, skipping the blank line before the first boundary", () => {
    const boundary = boundaryFromContentType(GMAIL_BATCH_CONTENT_TYPE)!;
    const { parts, complete } = parseMultipart(bytes(GMAIL_BATCH_BODY), boundary);

    expect(complete).toBe(true);
    expect(parts).toHaveLength(1);
    const part = parts[0]!;
    expect(part.mediaType).toBe("application/http");
    expect(part.contentId).toBe("response-gtlr_43499");

    const message = parseHttpMessage(part.body)!;
    expect(message.status).toBe(200);
    expect(message.statusReason).toBe("OK");
    expect(message.headers.filter((h) => h.name === "Vary").map((h) => h.value)).toEqual([
      "Origin",
      "X-Origin",
      "Referer",
    ]);
    expect(headerValue(message.headers, "content-type")).toBe("application/json; charset=UTF-8");
    expect(JSON.parse(text(message.body))).toMatchObject({ id: "IMPORTANT", messagesTotal: 23545 });
  });

  test("skips a text preamble and ignores the epilogue", () => {
    const body = [
      "This is a multi-part message in MIME format.",
      "--b",
      'Content-Disposition: form-data; name="a"',
      "",
      "one",
      "--b",
      'Content-Disposition: form-data; name="b"',
      "",
      "two",
      "--b--",
      "This is the epilogue. --b",
    ].join("\r\n");
    const { parts, complete } = parseMultipart(bytes(body), "b");
    expect(complete).toBe(true);
    expect(parts.map((p) => [p.name, text(p.body)])).toEqual([
      ["a", "one"],
      ["b", "two"],
    ]);
  });

  test("shows the parts that arrived when the closing delimiter is missing", () => {
    const body = ["--b", "Content-Type: text/plain", "", "one", "--b", "", "two cut sh"].join(
      "\r\n",
    );
    const { parts, complete } = parseMultipart(bytes(body), "b");
    expect(complete).toBe(false);
    expect(parts.map((p) => text(p.body))).toEqual(["one", "two cut sh"]);
    expect(parts[1]!.headers).toEqual([]);
  });

  test("tolerates a missing final line break and LF-only line endings", () => {
    const body = ["--b", "Content-Type: text/plain", "", "one", "--b--"].join("\n");
    const { parts, complete } = parseMultipart(bytes(body), "b");
    expect(complete).toBe(true);
    expect(text(parts[0]!.body)).toBe("one");
  });

  test("parses a multipart part nested inside a part", () => {
    const inner = ["--inner", "Content-Type: text/plain", "", "deep", "--inner--"].join("\r\n");
    const body = [
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      inner,
      "--outer",
      "Content-Type: text/plain",
      "",
      "shallow",
      "--outer--",
    ].join("\r\n");
    const outer = parseMultipart(bytes(body), "outer");
    expect(outer.parts).toHaveLength(2);
    const nested = outer.parts[0]!;
    expect(nested.mediaType).toBe("multipart/alternative");
    const innerResult = parseMultipart(nested.body, boundaryFromContentType(nested.contentType)!);
    expect(innerResult.complete).toBe(true);
    expect(text(innerResult.parts[0]!.body)).toBe("deep");
    expect(text(outer.parts[1]!.body)).toBe("shallow");
  });

  test("keeps a binary part's bytes exactly", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x0d, 0x0a,
    ]);
    const head = bytes(
      [
        "--b",
        'Content-Disposition: form-data; name="file"; filename="a.bin"',
        "Content-Type: application/octet-stream",
        "",
        "",
      ].join("\r\n"),
    );
    const tail = bytes("\r\n--b--\r\n");
    const body = new Uint8Array([...head, ...png, ...tail]);
    const { parts } = parseMultipart(body, "b");
    expect(parts[0]!.filename).toBe("a.bin");
    expect(Array.from(parts[0]!.body)).toEqual(Array.from(png));
    expect(isProbablyBinary(parts[0]!.body)).toBe(true);
  });

  test("handles quoted boundaries with special characters", () => {
    const boundary = "a'b(c)+_,-./:=? d";
    const contentType = `multipart/form-data; boundary="${boundary}"; charset=utf-8`;
    expect(boundaryFromContentType(contentType)).toBe(boundary);
    // What the panes cut from the header after `boundary=`
    expect(normalizeBoundary(`"${boundary}"; charset=utf-8`)).toBe(boundary);
    expect(normalizeBoundary("simple; charset=utf-8")).toBe("simple");

    const body = [`--${boundary}`, "", "x", `--${boundary}--`].join("\r\n");
    const { parts } = parseMultipart(bytes(body), `"${boundary}"`);
    expect(parts.map((p) => text(p.body))).toEqual(["x"]);
  });

  test("does not take a longer boundary for this one", () => {
    const body = ["--b", "", "x", "--bb", "still x", "--b--"].join("\r\n");
    const { parts } = parseMultipart(bytes(body), "b");
    expect(parts.map((p) => text(p.body))).toEqual(["x\r\n--bb\r\nstill x"]);
  });

  test("reads quoted and extended disposition parameters", () => {
    const body = [
      "--b",
      `Content-Disposition: form-data; name="a;b"; filename*=UTF-8''r%C3%A9sum%C3%A9.txt`,
      "",
      "x",
      "--b--",
    ].join("\r\n");
    const { parts } = parseMultipart(bytes(body), "b");
    expect(parts[0]!.name).toBe("a;b");
    expect(parts[0]!.filename).toBe("résumé.txt");
  });

  test("throws when the boundary never appears", () => {
    expect(() => parseMultipart(bytes("nothing here"), "b")).toThrow(/No "--b" delimiter/);
  });

  test("parses the same bytes once", () => {
    const data = bytes(GMAIL_BATCH_BODY);
    expect(parseMultipart(data, GMAIL_BATCH_BOUNDARY)).toBe(
      parseMultipart(data, GMAIL_BATCH_BOUNDARY),
    );
  });
});

describe("parseHttpMessage", () => {
  test("parses a request line, as in an OData batch", () => {
    const message = parseHttpMessage(
      bytes("GET /people(1) HTTP/1.1\r\nAccept: application/json\r\n\r\n"),
    )!;
    expect(message.method).toBe("GET");
    expect(message.url).toBe("/people(1)");
    expect(message.status).toBeNull();
    expect(message.body).toHaveLength(0);
  });

  test("returns null for something that isn't HTTP", () => {
    expect(parseHttpMessage(bytes("hello world"))).toBeNull();
  });
});
