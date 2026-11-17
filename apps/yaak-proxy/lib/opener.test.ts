import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const opener = vi.hoisted(() => ({
  openUrl: vi.fn<(url: string) => Promise<void>>(),
  revealItemInDir: vi.fn<(path: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-opener", () => opener);

const { openLink, revealLabel, revealPath } = await import("./opener");

describe("opener", () => {
  beforeEach(() => {
    opener.openUrl.mockReset();
    opener.revealItemInDir.mockReset();
  });

  test("a folder that can't be shown says so", async () => {
    opener.revealItemInDir.mockRejectedValue("not allowed: opener.reveal_item_in_dir");
    const report = vi.fn();
    await revealPath("/data/app.yaak.proxy", report);
    expect(opener.revealItemInDir).toHaveBeenCalledWith("/data/app.yaak.proxy");
    expect(report).toHaveBeenCalledWith(
      "Failed to reveal /data/app.yaak.proxy: not allowed: opener.reveal_item_in_dir",
    );
  });

  test("nothing to report when it works", async () => {
    opener.revealItemInDir.mockResolvedValue();
    opener.openUrl.mockResolvedValue();
    const report = vi.fn();
    await revealPath("/logs", report);
    await openLink("https://yaak.app", report);
    expect(report).not.toHaveBeenCalled();
  });

  test("a link that can't be opened says so", async () => {
    opener.openUrl.mockRejectedValue(new Error("denied"));
    const report = vi.fn();
    await openLink("https://yaak.app", report);
    expect(report).toHaveBeenCalledWith("Failed to open https://yaak.app: Error: denied");
  });

  test("names the file manager by platform", () => {
    expect(revealLabel("macos")).toBe("Reveal in Finder");
    expect(revealLabel("windows")).toBe("Show in Explorer");
    expect(revealLabel("linux")).toBe("Show in File Manager");
  });
});
