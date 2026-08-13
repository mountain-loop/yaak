import { describe, expect, test } from "vite-plus/test";
import { decodeBase64Prefix, labelForMime, SNIFF_HEAD_CHARS, sniffValue } from "./sniffValue";

/** A base64 value that starts with `magic` and runs on for a while, as a real one would */
function base64Of(magic: number[], length = 2_000): string {
  const bytes = new Uint8Array(length);
  bytes.set(magic);
  for (let i = magic.length; i < length; i++) {
    bytes[i] = i % 251;
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** One character, one byte. These are all ASCII signatures. */
function ascii(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    bytes.push(s.charCodeAt(i));
  }
  return bytes;
}

/** Four bytes no signature looks at: a RIFF chunk length, or an ISO-BMFF box size */
const IGNORED = [0x00, 0x00, 0x00, 0x20];

const PNG = [0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PDF = ascii("%PDF-1.7");

describe("magic numbers", () => {
  const cases: [string, number[], string, string][] = [
    ["PNG", PNG, "image/png", "PNG"],
    ["JPEG", JPEG, "image/jpeg", "JPEG"],
    ["GIF", ascii("GIF89a"), "image/gif", "GIF"],
    ["PDF", PDF, "application/pdf", "PDF"],
    ["WEBP", [...ascii("RIFF"), ...IGNORED, ...ascii("WEBP")], "image/webp", "WEBP"],
    ["WAV", [...ascii("RIFF"), ...IGNORED, ...ascii("WAVE")], "audio/wav", "WAV"],
    ["ZIP", [...ascii("PK"), 0x03, 0x04], "application/zip", "ZIP"],
    ["GZIP", [0x1f, 0x8b, 0x08], "application/gzip", "GZIP"],
    ["MP3", [...ascii("ID3"), 0x04], "audio/mpeg", "MP3"],
    ["OGG", ascii("OggS"), "audio/ogg", "OGG"],
    ["FLAC", ascii("fLaC"), "audio/flac", "FLAC"],
    ["WEBM", [0x1a, 0x45, 0xdf, 0xa3], "video/webm", "WEBM"],
    ["MP4", [...IGNORED, ...ascii("ftypisom")], "video/mp4", "MP4"],
    ["AVIF", [...IGNORED, ...ascii("ftypavif")], "image/avif", "AVIF"],
    ["HEIC", [...IGNORED, ...ascii("ftypheic")], "image/heic", "HEIC"],
    ["M4A", [...IGNORED, ...ascii("ftypM4A ")], "audio/mp4", "M4A"],
    ["MOV", [...IGNORED, ...ascii("ftypqt  ")], "video/quicktime", "MOV"],
    ["BMP", ascii("BMxx"), "image/bmp", "BMP"],
    ["TIFF", [...ascii("II"), 0x2a, 0x00], "image/tiff", "TIFF"],
  ];

  for (const [name, magic, mime, label] of cases) {
    test(`recognises ${name}`, () => {
      expect(sniffValue(base64Of(magic))).toEqual({ mime, label, offset: 0, encoding: "base64" });
    });
  }

  test("recognises nothing in arbitrary base64", () => {
    expect(sniffValue(btoa("just some text that happens to be encoded"))).toBeNull();
  });

  test("recognises nothing in text that isn't base64", () => {
    expect(sniffValue("the quick brown fox jumps over the lazy dog".repeat(10))).toBeNull();
  });

  test("recognises nothing in a JWT-shaped value", () => {
    expect(sniffValue(`${btoa('{"alg":"HS256"}')}.${btoa('{"sub":"1"}')}.c2ln`)).toBeNull();
  });

  test("reads the url-safe alphabet", () => {
    const urlSafe = base64Of(PNG).replaceAll("+", "-").replaceAll("/", "_");
    expect(sniffValue(urlSafe)?.label).toBe("PNG");
  });

  test("ignores leading whitespace, and counts it in the offset", () => {
    expect(sniffValue(`   ${base64Of(PNG)}`)).toMatchObject({ label: "PNG", offset: 3 });
  });
});

describe("data URIs", () => {
  test("takes the declared type over the bytes", () => {
    const uri = `data:image/svg+xml;base64,${btoa("<svg/>")}`;
    expect(sniffValue(uri)).toEqual({
      mime: "image/svg+xml",
      label: "SVG",
      offset: "data:image/svg+xml;base64,".length,
      encoding: "base64",
    });
  });

  test("points past the header, so the payload can be decoded from there", () => {
    const payload = base64Of(PNG);
    const uri = `data:image/png;base64,${payload}`;
    const sniffed = sniffValue(uri)!;
    expect(uri.slice(sniffed.offset, sniffed.offset + 8)).toBe(payload.slice(0, 8));
  });

  test("falls back to the bytes when the declared type says nothing", () => {
    const uri = `data:application/octet-stream;base64,${base64Of(PDF)}`;
    expect(sniffValue(uri)).toMatchObject({ mime: "application/pdf", label: "PDF" });
  });

  test("handles a header with no type at all", () => {
    expect(sniffValue(`data:;base64,${base64Of(JPEG)}`)).toMatchObject({ mime: "image/jpeg" });
  });

  test("handles extra parameters", () => {
    const uri = `data:text/plain;charset=utf-8;base64,${btoa("hello")}`;
    expect(sniffValue(uri)).toMatchObject({ mime: "text/plain", encoding: "base64" });
  });

  test("handles a percent-encoded payload", () => {
    expect(sniffValue("data:text/html,%3Ch1%3Ehi%3C/h1%3E")).toEqual({
      mime: "text/html",
      label: "HTML",
      offset: "data:text/html,".length,
      encoding: "percent",
    });
  });

  test("defaults a bare percent-encoded payload to text", () => {
    expect(sniffValue("data:,hello%20there")).toMatchObject({
      mime: "text/plain",
      encoding: "percent",
    });
  });
});

describe("decoding only the head", () => {
  test("reads no more of the value than the bytes asked for", () => {
    const big = base64Of(PNG, 3_000_000);
    // Truncating to the head must not change what is found, which is the whole point:
    // callers only ever hand it a slice
    expect(sniffValue(big.slice(0, SNIFF_HEAD_CHARS))).toEqual(sniffValue(big));
  });

  test("decodes whole 4-character groups only", () => {
    // 12 bytes needs 16 characters; a 15-character slice yields the 12 bytes of 3 whole groups
    expect(decodeBase64Prefix(base64Of(PNG), 0, 12)).toHaveLength(12);
    expect(decodeBase64Prefix(base64Of(PNG).slice(0, 15), 0, 12)).toHaveLength(9);
  });

  test("declines a value too short to hold a group", () => {
    expect(decodeBase64Prefix("abc", 0, 12)).toBeNull();
  });

  test("declines text outside the alphabet", () => {
    expect(decodeBase64Prefix("hello world, not base64!", 0, 12)).toBeNull();
  });
});

describe("labels", () => {
  test.each([
    ["image/png", "PNG"],
    ["image/svg+xml", "SVG"],
    ["text/plain", "TEXT"],
    ["application/vnd.ms-excel", "MS-EXCEL"],
    ["image/x-icon", "ICON"],
    ["application/octet-stream", "APPLICATION"],
    ["font/woff2", "WOFF2"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "DOCUMENT"],
  ])("%s reads as %s", (mime, label) => {
    expect(labelForMime(mime)).toBe(label);
  });
});
