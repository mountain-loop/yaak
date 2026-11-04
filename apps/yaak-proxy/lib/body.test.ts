import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test, vi } from "vite-plus/test";
import { bodyAsText, bodyFileName, bytesToText, flowBodyQueryOptions, viewerText } from "./body";
import { rpc } from "./rpc";

vi.mock("./rpc", () => ({ rpc: vi.fn() }));

const encode = (text: string) => new TextEncoder().encode(text);

describe("bytesToText", () => {
  test("decodes UTF-8", () => {
    expect(bytesToText(encode("abc€"))).toBe("abc€");
  });

  test("rejects a body that is not UTF-8", () => {
    expect(bytesToText(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull();
  });

  test("keeps a truncated body cut partway through a character", () => {
    const cut = encode("abc€").subarray(0, 5);
    expect(bytesToText(cut)).toBeNull();
    expect(bytesToText(cut, true)).toBe("abc");
  });
});

describe("bodyAsText", () => {
  test("reads UTF-8 as text", () => {
    expect(bodyAsText(encode("<h1>Forbidden</h1>\n\tcafé"))).toBe("<h1>Forbidden</h1>\n\tcafé");
  });

  test("reads unlabeled Latin-1 text as text, as windows-1252", () => {
    const page = "<p>Accès refusé : vous n'avez pas l'autorisation d'accéder à cette page.</p>";
    const latin1 = Uint8Array.from(page, (c) => c.charCodeAt(0));
    expect(bodyAsText(latin1)).toBe(page);
  });

  test("reads bytes UTF-8 can't read as binary, though windows-1252 reads every one", () => {
    let seed = 7;
    const random = Uint8Array.from({ length: 600 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed >> 16;
    });
    expect(bodyAsText(random)).toBeNull();
    // All high bytes: letters and symbols in windows-1252, none of them UTF-8
    const high = Uint8Array.from({ length: 600 }, (_, i) => 0xa0 + (i % 96));
    expect(bodyAsText(high)).toBeNull();
    expect(bodyAsText(high, false, "text/plain")).toBeNull();
  });

  test("reads protobuf and other binary as binary, even when it is valid UTF-8", () => {
    // Field tags, lengths and varints: control characters between short strings.
    const protobuf = new Uint8Array([
      0x0a, 0x04, 0x6b, 0x65, 0x79, 0x31, 0x12, 0x02, 0x08, 0x01, 0x1a, 0x03, 0x10, 0x96, 0x01,
      0x22, 0x00, 0x2a, 0x02, 0x18, 0x07,
    ]);
    expect(bodyAsText(protobuf)).toBeNull();
    expect(bodyAsText(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x41, 0x42]))).toBeNull();
    expect(bodyAsText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
  });
});

describe("viewerText", () => {
  // A PNG signature, then a tEXt chunk of printable metadata far longer than the image
  const png = new Uint8Array([
    0x89,
    ...encode("PNG\r\n"),
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x12,
    0xc0,
    ...encode(`tEXtDescription\0${"A long printable description. ".repeat(160)}`),
  ]);

  test("keeps an image with printable metadata an image", () => {
    expect(bodyAsText(png)).not.toBeNull();
    expect(viewerText(png, false, "image/png")).toBeNull();
  });

  test("reads text sent as an image as text, and other types text first", () => {
    expect(viewerText(encode("<h1>Forbidden</h1>"), false, "image/png")).toBe("<h1>Forbidden</h1>");
    expect(viewerText(encode("<svg/>"), false, "image/svg+xml")).toBe("<svg/>");
    expect(viewerText(png, false, "application/octet-stream")).not.toBeNull();
  });

  test("reads text in the charset its content type names", () => {
    const page = "Accès refusé : vous n'avez pas l'autorisation d'accéder à cette page.";
    const latin1 = Uint8Array.from(page, (c) => c.charCodeAt(0));
    expect(viewerText(latin1, false, "text/html; charset=iso-8859-1")).toBe(page);
    // "こんにちは、世界" in Shift_JIS
    const shiftJis = new Uint8Array([
      0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x81, 0x41, 0x90, 0xa2, 0x8a,
      0x45,
    ]);
    expect(viewerText(shiftJis, false, "text/plain; charset=shift_jis")).toBe("こんにちは、世界");
  });

  test("reads unlabeled Latin-1 as windows-1252, and UTF-8 as UTF-8", () => {
    const page = "Accès refusé : vous n'avez pas l'autorisation d'accéder à cette page.";
    const latin1 = Uint8Array.from(page, (c) => c.charCodeAt(0));
    expect(viewerText(latin1, false, "application/octet-stream")).toBe(page);
    expect(viewerText(encode(page), false, "application/octet-stream")).toBe(page);
    expect(viewerText(encode(page), false, "text/plain; charset=utf-8")).toBe(page);
  });
});

const flow = (url: string, contentType: string | null) =>
  ({
    id: "fl_1",
    url,
    updatedAt: "2026-11-04T00:00:00",
    requestHeaders: contentType == null ? [] : [{ name: "Content-Type", value: contentType }],
    responseHeaders: contentType == null ? [] : [{ name: "content-type", value: contentType }],
  }) as unknown as Flow;

describe("bodyFileName", () => {
  test("uses the URL's file name for a response", () => {
    expect(bodyFileName(flow("https://a.test/img/logo%20big.png?v=2", null), "response")).toBe(
      "logo big.png",
    );
  });

  test("names a body from its content type otherwise", () => {
    const protobuf = flow("https://a.test/v1:GetModels", "application/x-protobuf");
    expect(bodyFileName(protobuf, "request")).toBe("request.protobuf");
    expect(bodyFileName(protobuf, "response")).toBe("response.protobuf");
    expect(bodyFileName(flow("https://a.test/", "text/plain; charset=utf-8"), "response")).toBe(
      "response.txt",
    );
    expect(bodyFileName(flow("https://a.test/api", "application/problem+json"), "response")).toBe(
      "response.json",
    );
    expect(bodyFileName(flow("https://a.test/data.json", null), "request")).toBe("request.bin");
    expect(bodyFileName(flow("not a url", "application/octet-stream"), "response")).toBe(
      "response.bin",
    );
  });
});

describe("flowBodyQueryOptions", () => {
  test("shows a body that fails to read at once, without retrying", async () => {
    vi.mocked(rpc).mockRejectedValue(new Error("No flow fl_1"));
    // React Query retries three times in a browser, and not at all where there is no window.
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
    const observer = new QueryObserver(
      client,
      flowBodyQueryOptions(flow("https://a.test/", null), "response"),
    );
    const failed = new Promise<string>((resolve) => {
      const unsubscribe = observer.subscribe((result) => {
        if (result.status === "error") {
          unsubscribe();
          resolve(result.error.message);
        }
      });
    });
    // React Query's default retries would keep it pending for seconds.
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 500));
    expect(await Promise.race([failed, timeout])).toBe("No flow fl_1");
    expect(rpc).toHaveBeenCalledTimes(1);
    client.clear();
  });

  test("passes on why a body failed to decode, with its bytes as they were", async () => {
    vi.mocked(rpc).mockResolvedValue({
      data: btoa("\x78\x9c\x01"),
      truncated: false,
      storedSize: 3,
      decodeError: "Failed to decode Deflate body: deflate decompression error",
    });
    const client = new QueryClient();
    const body = await client.fetchQuery(
      flowBodyQueryOptions(flow("https://a.test/", null), "request"),
    );
    expect(Array.from(body.bytes)).toEqual([0x78, 0x9c, 0x01]);
    expect(body.decodeError).toBe("Failed to decode Deflate body: deflate decompression error");
    client.clear();
  });
});
