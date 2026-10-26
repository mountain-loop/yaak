import { describe, expect, test } from "vite-plus/test";
import { bytesToText } from "./body";

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
