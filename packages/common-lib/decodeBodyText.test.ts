import { describe, expect, test } from "vitest";
import { contentTypeCharset, decodeBodyText, strictUtf8Text } from "./decodeBodyText";

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
// "こんにちは、世界" in Shift_JIS
const shiftJis = new Uint8Array([
  0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x81, 0x41, 0x90, 0xa2, 0x8a, 0x45,
]);
const french = "Accès refusé : vous n'avez pas l'autorisation d'accéder à cette page.";

describe("decodeBodyText", () => {
  test("decodes in the charset the content type names", () => {
    const body = latin1(french);
    expect(decodeBodyText(body, "text/html; charset=iso-8859-1")).toBe(french);
    expect(decodeBodyText(body, 'text/plain; CHARSET="ISO-8859-1"')).toBe(french);
    expect(decodeBodyText(shiftJis, "text/plain; charset=Shift_JIS")).toBe("こんにちは、世界");
  });

  test("reads an unlabeled body that isn't UTF-8 as windows-1252", () => {
    expect(decodeBodyText(latin1(french), "text/html")).toBe(french);
    expect(decodeBodyText(latin1(french), null)).toBe(french);
    expect(decodeBodyText(new Uint8Array([0x93, 0x68, 0x69, 0x94]), null)).toBe("“hi”");
  });

  test("reads UTF-8 as UTF-8, labeled or not", () => {
    const utf8 = new TextEncoder().encode(`{"city":"Zürich","greeting":"こんにちは"}`);
    const text = `{"city":"Zürich","greeting":"こんにちは"}`;
    expect(decodeBodyText(utf8, null)).toBe(text);
    expect(decodeBodyText(utf8, "application/json")).toBe(text);
    expect(decodeBodyText(utf8, "application/json; charset=utf-8")).toBe(text);
    // A body labeled UTF-8 stays UTF-8, with what isn't replaced, as before
    expect(decodeBodyText(new Uint8Array([0x61, 0xff]), "text/plain; charset=utf-8")).toBe("a�");
  });

  test("treats a charset TextDecoder doesn't know as no charset", () => {
    expect(contentTypeCharset("text/plain; charset=not-a-charset")).toBeNull();
    expect(decodeBodyText(latin1(french), "text/plain; charset=not-a-charset")).toBe(french);
  });

  test("keeps a truncated UTF-8 body UTF-8 when it ends partway through a character", () => {
    const cut = new TextEncoder().encode("abc€").subarray(0, 5);
    expect(strictUtf8Text(cut)).toBeNull();
    expect(decodeBodyText(cut, null, { truncated: true })).toBe("abc");
  });
});
