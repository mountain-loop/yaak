import { describe, expect, test } from "vite-plus/test";
import { createResponseBody, decodeBase64Chunk } from "../src/responseBody";

/** A store of bytes that records every window it was asked for. */
function fakeBody(bytes: Uint8Array, contentType: string | null) {
  const reads: Array<[number, number]> = [];
  const body = createResponseBody(
    { responseId: "rs_test", contentLength: bytes.byteLength, contentType },
    async (offset, length) => {
      reads.push([offset, length]);
      return bytes.slice(offset, offset + length);
    },
  );
  return { body, reads };
}

function utf8(text: string) {
  return new TextEncoder().encode(text);
}

describe("response body", () => {
  test("pulls a body in chunks and reassembles it", async () => {
    const { body, reads } = fakeBody(utf8("abcdefghij"), "text/plain");

    expect(await body.text({ chunkSize: 4 })).toEqual("abcdefghij");
    expect(reads).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ]);
  });

  test("can be read more than once, unlike fetch", async () => {
    const { body } = fakeBody(utf8('{"a":1}'), "application/json");

    expect(await body.text()).toEqual('{"a":1}');
    expect(await body.json()).toEqual({ a: 1 });
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(utf8('{"a":1}'));
  });

  test("decodes using the charset the response declared", async () => {
    // "café naïve" as Latin-1, which is mojibake if read as UTF-8.
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65]);

    const declared = fakeBody(latin1, "text/plain; charset=iso-8859-1");
    expect(await declared.body.text()).toEqual("café naïve");

    const undeclared = fakeBody(latin1, "text/plain");
    expect(await undeclared.body.text()).not.toEqual("café naïve");
  });

  test("falls back to UTF-8 for a charset the runtime doesn't know", async () => {
    const { body } = fakeBody(utf8("hello"), "text/plain; charset=not-a-real-charset");
    expect(await body.text()).toEqual("hello");
  });

  test("drops a UTF-8 BOM", async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('{"a":1}')]);
    const { body } = fakeBody(withBom, "application/json");

    expect(await body.text()).toEqual('{"a":1}');
    expect(await body.json()).toEqual({ a: 1 });
  });

  test("refuses to buffer past maxBytes, and says what to do instead", async () => {
    const { body } = fakeBody(utf8("x".repeat(100)), "text/plain");

    await expect(body.text({ maxBytes: 50 })).rejects.toThrow(/chunks\(\)/);
    await expect(body.json({ maxBytes: 50 })).rejects.toThrow(/over the/);
    await expect(body.arrayBuffer({ maxBytes: 50 })).rejects.toThrow(/arrayBuffer\(\)/);

    // The ceiling is the caller's to raise.
    expect(await body.text({ maxBytes: 100 })).toHaveLength(100);
  });

  test("streams past maxBytes through chunks()", async () => {
    const { body } = fakeBody(utf8("x".repeat(100)), "text/plain");

    let total = 0;
    for await (const chunk of body.chunks({ chunkSize: 10 })) {
      total += chunk.byteLength;
    }
    expect(total).toEqual(100);
  });

  test("stops early when the host runs out of bytes sooner than it claimed", async () => {
    // contentLength says 100; the store only ever hands back 10.
    const body = createResponseBody(
      { responseId: "rs_test", contentLength: 100, contentType: "text/plain" },
      async (offset) => (offset === 0 ? utf8("0123456789") : new Uint8Array()),
    );

    expect(await body.text()).toEqual("0123456789");
  });

  test("a response with no body reads as empty", async () => {
    const { body, reads } = fakeBody(new Uint8Array(), "application/json");

    expect(body.contentLength).toEqual(0);
    expect(await body.text()).toEqual("");
    expect(reads).toEqual([]);
  });

  test("keeps binary bytes intact", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const { body } = fakeBody(png, "image/png");

    expect(new Uint8Array(await body.arrayBuffer({ chunkSize: 3 }))).toEqual(png);
  });
});

describe("decodeBase64Chunk", () => {
  test("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    const base64 = Buffer.from(bytes).toString("base64");
    expect(decodeBase64Chunk(base64)).toEqual(bytes);
  });

  test("decodes an empty chunk", () => {
    expect(decodeBase64Chunk("")).toEqual(new Uint8Array());
  });
});
