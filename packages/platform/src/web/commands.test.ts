import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { commandSupport, runCommand } from "./commands";
import type { WorkerConnection } from "./connection";
import { sendHttpRequest } from "./send";

vi.mock("./send", () => ({ sendHttpRequest: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe("browser assertion commands", () => {
  it.each([
    ["cmd_validate_http_assertions", { assertions: { version: 1, checks: [] } }],
    [
      "cmd_preview_http_assertions",
      { responseId: "rs_pinned_history", assertions: { version: 1, checks: [] } },
    ],
    ["cmd_http_response_json_children", { responseId: "rs_pinned_history", parent: "$.user" }],
  ])("routes %s to the local worker without a send or model write", async (command, payload) => {
    const report = { from: "local worker" };
    const rpc = vi.fn().mockResolvedValue(report);
    const db = { rpc } as unknown as WorkerConnection;
    expect(commandSupport().implemented).toContain(command);
    expect(await runCommand(command, payload, db)).toBe(report);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(command, payload);
    expect(sendHttpRequest).not.toHaveBeenCalled();
  });

  it("does not resend when a saved response is no longer available", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("Response not found"));
    const db = { rpc } as unknown as WorkerConnection;
    await expect(
      runCommand(
        "cmd_preview_http_assertions",
        { responseId: "rs_removed", assertions: { version: 1, checks: [] } },
        db,
      ),
    ).rejects.toThrow("Response not found");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(sendHttpRequest).not.toHaveBeenCalled();
  });
});
