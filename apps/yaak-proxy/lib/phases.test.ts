import { describe, expect, test } from "vite-plus/test";
import { flowPhases, type PhaseFlow } from "./phases";

const done: PhaseFlow = {
  elapsedConnectMs: 12,
  elapsedTlsMs: 40,
  elapsedRequestMs: 41,
  elapsedHeadersMs: 90,
  elapsedMs: 120,
  status: 200,
  error: null,
  cancelled: false,
  streamKind: null,
};

describe("flowPhases", () => {
  test("lists each phase with how long it took", () => {
    expect(flowPhases(done).map((p) => [p.key, p.atMs, p.tookMs])).toEqual([
      ["start", 0, 0],
      ["connect", 12, 12],
      ["tls", 40, 28],
      ["request", 41, 1],
      ["headers", 90, 49],
      ["end", 120, 30],
    ]);
  });

  test("leaves out phases the engine has no time for", () => {
    const phases = flowPhases({
      ...done,
      elapsedConnectMs: null,
      elapsedTlsMs: null,
      elapsedRequestMs: null,
    });
    expect(phases.map((p) => p.key)).toEqual(["start", "headers", "end"]);
  });

  test("an open flow has no end yet", () => {
    const phases = flowPhases({ ...done, elapsedMs: null });
    expect(phases.at(-1)?.key).toBe("headers");
  });

  test("a failure ends with the engine's error", () => {
    const phases = flowPhases({
      ...done,
      elapsedTlsMs: null,
      elapsedRequestMs: null,
      elapsedHeadersMs: null,
      elapsedMs: 31,
      status: null,
      error: "Connection refused",
    });
    expect(phases.at(-1)).toMatchObject({ kind: "error", atMs: 31, detail: "Connection refused" });
  });

  test("a stream closes", () => {
    expect(flowPhases({ ...done, streamKind: "websocket" }).at(-1)?.label).toBe("Closed");
  });
});
