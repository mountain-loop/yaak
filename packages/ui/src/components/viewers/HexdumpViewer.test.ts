import { hexy } from "hexy";
import { describe, expect, test, vi } from "vite-plus/test";
import { hexdump } from "./HexdumpViewer";

vi.mock("hexy", () => ({ hexy: vi.fn((data: number[]) => `dump of ${data.length} bytes`) }));

describe("hexdump", () => {
  test("makes the hexdump of the same bytes once", () => {
    const message = [0x01, 0x02, 0x03];
    expect(hexdump(message)).toBe("dump of 3 bytes");
    expect(hexdump(message)).toBe("dump of 3 bytes");
    expect(hexy).toHaveBeenCalledTimes(1);

    // Other bytes, even equal ones, get their own.
    expect(hexdump([0x01, 0x02, 0x03])).toBe("dump of 3 bytes");
    expect(hexy).toHaveBeenCalledTimes(2);
    expect(hexdump([])).toBe("");
    expect(hexy).toHaveBeenCalledTimes(2);
  });
});
