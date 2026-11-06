import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InternalEvent } from "@yaakapp/api";
import { expect, test } from "vite-plus/test";
import { EventChannel } from "../src/EventChannel";
import { PluginInstance } from "../src/PluginInstance";

test("the runtime forwards per-send environments without changing plugin context", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "yaak-send-environment-"));
  await mkdir(path.join(dir, "build"));
  await writeFile(
    path.join(dir, "build/index.js"),
    `exports.plugin = { async init(ctx) {
      await Promise.all(["ev_a", "ev_b", undefined].map(environmentId =>
        ctx.httpRequest.send({ httpRequest: { id: "rq_test" }, environmentId })
      ));
    } };`,
  );
  const channel = new EventChannel();
  const context = { workspaceId: "wk_test", label: "test-window" };
  const bootRequest = { dir, watch: false };
  const instance = new PluginInstance({ bootRequest, pluginRefId: "test", context }, channel);
  const sends: InternalEvent[] = [];
  const booted = new Promise<void>((resolve, reject) => {
    channel.listen((event) => {
      if (event.payload.type === "send_http_request_request") {
        // Match the JSON transport used by the real plugin host.
        sends.push(JSON.parse(JSON.stringify(event)) as InternalEvent);
        instance.postMessage({
          ...event,
          id: `reply-${event.id}`,
          replyId: event.id,
          payload: { type: "error_response", error: "test host received send" },
        });
      } else if (event.payload.type === "error_response") {
        // The stub host rejects the sends after capturing them.
        if (event.payload.error === "test host received send") resolve();
        else reject(new Error(event.payload.error));
      } else if (event.payload.type === "boot_response") {
        reject(new Error("Expected the test host's send error"));
      }
    });
  });
  try {
    instance.postMessage({
      id: "boot",
      replyId: null,
      pluginRefId: "test",
      pluginName: "test",
      context,
      payload: { type: "boot_request", ...bootRequest },
    });
    await booted;
    expect(sends.map((event) => event.payload)).toEqual([
      { type: "send_http_request_request", httpRequest: { id: "rq_test" }, environmentId: "ev_a" },
      { type: "send_http_request_request", httpRequest: { id: "rq_test" }, environmentId: "ev_b" },
      { type: "send_http_request_request", httpRequest: { id: "rq_test" } },
    ]);
    expect(sends.map((event) => event.context)).toEqual([context, context, context]);
  } finally {
    await instance.terminate();
    await rm(dir, { recursive: true, force: true });
  }
});
