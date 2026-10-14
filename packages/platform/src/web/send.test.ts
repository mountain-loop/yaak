import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpAssertions, HttpResponse } from "@yaakapp-internal/models";
import type { WorkerConnection } from "./connection";
import { sendHttpRequest } from "./send";

vi.mock("./server", () => ({
  serverIdentity: async () => "test server",
  serverSendUrl: () => "https://test.invalid/send",
  readFrames: async function* () {
    yield {
      type: "response",
      status: 200,
      headers: [],
      requestHeaders: [],
      url: "https://example.com",
    };
    yield { type: "body", data: btoa('{"id":123}') };
    yield { type: "done", contentLength: 10, contentLengthCompressed: 10, elapsed: 1 };
  },
}));

const definition: HttpAssertions = {
  version: 1,
  checks: [
    {
      id: "check",
      enabled: true,
      target: "json",
      selector: "$.id",
      operator: "equals",
      expected: "SECRET_EXPECTED",
      expectedType: "text",
    },
  ],
};

function worker() {
  let cancel: (() => void) | undefined;
  let storedBody: Uint8Array | undefined;
  const evaluations: {
    definition: HttpAssertions;
    response: Partial<HttpResponse>;
    canceled: boolean;
  }[] = [];
  const writes: Partial<HttpResponse>[] = [];
  const request = {
    id: "rq_test",
    model: "http_request",
    workspaceId: "wk_test",
    assertions: structuredClone(definition),
  };
  const db = {
    rpc: async (cmd: string, payload: Record<string, unknown>) => {
      if (cmd === "web_get_http_request") return structuredClone(request);
      if (cmd === "models_upsert") {
        writes.push(structuredClone(payload.model as Partial<HttpResponse>));
        return "rs_test";
      }
      if (cmd === "evaluate_http_assertions") {
        const input = payload as (typeof evaluations)[number];
        if (!input.response.error) expect(new TextDecoder().decode(storedBody)).toBe('{"id":123}');
        evaluations.push(structuredClone(input));
        return {
          definition: input.definition,
          results: [
            {
              assertionId: "check",
              outcome: input.response.error ? "error" : "passed",
              reason: "test evaluator",
              actual: null,
            },
          ],
          error: null,
        };
      }
      return null;
    },
    prepareHttpSend: async () => ({ request, settings: {}, cookieJar: null, settingEvents: [] }),
    blobPut: async (_id: string, bytes: Uint8Array) => {
      storedBody = bytes;
    },
    listen: (_event: string, callback: () => void) => {
      cancel = callback;
      return () => {
        cancel = undefined;
      };
    },
  } as unknown as WorkerConnection;
  return { db, evaluations, writes, cancel: () => cancel?.() };
}

afterEach(() => vi.unstubAllGlobals());

describe("browser assertion evaluation", () => {
  it("evaluates locally after saving the body and keeps assertion values out of the proxy request", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.body).not.toContain("SECRET_EXPECTED");
      return new Response("stream");
    });
    vi.stubGlobal("fetch", fetch);
    const { db, evaluations, writes } = worker();
    const response = await sendHttpRequest(db, "rq_test", null, null);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.definition).toEqual(definition);
    expect(evaluations[0]?.canceled).toBe(false);
    expect(response.assertionResults?.results[0]?.outcome).toBe("passed");
    expect(writes.at(-1)?.state).toBe("closed");
    expect(writes.at(-1)?.assertionResults).toEqual(response.assertionResults);
  });

  it("marks a canceled response as incomplete before asking the shared evaluator", async () => {
    const { db, cancel, evaluations } = worker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        cancel();
        throw new Error("aborted");
      }),
    );
    const response = await sendHttpRequest(db, "rq_test", null, null);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.canceled).toBe(true);
    expect(evaluations[0]?.response.error).toBe("Request canceled");
    expect(response.assertionResults?.results[0]?.outcome).toBe("error");
  });
});
