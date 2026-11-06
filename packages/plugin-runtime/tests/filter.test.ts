import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InternalEvent, InternalEventPayload } from "@yaakapp/api";
import { expect, test } from "vite-plus/test";
import { EventChannel } from "../src/EventChannel";
import { PluginInstance } from "../src/PluginInstance";

test("ctx.filter asks the host and hands back its reply", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "yaak-filter-"));
  await mkdir(path.join(dir, "build"));
  await writeFile(
    path.join(dir, "build/index.js"),
    `exports.plugin = { async init(ctx) {
      const results = [
        await ctx.filter.jsonPath('{"a":1}', "$.a"),
        await ctx.filter.xPath("<a/>", "//b["),
      ];
      await ctx.toast.show({ message: JSON.stringify(results) });
    } };`,
  );
  const channel = new EventChannel();
  const context = { workspaceId: null, label: null };
  const bootRequest = { dir, watch: false };
  const instance = new PluginInstance({ bootRequest, pluginRefId: "test", context }, channel);
  const requests: InternalEventPayload[] = [];
  const reply = (event: InternalEvent, payload: InternalEventPayload) =>
    instance.postMessage({ ...event, id: `reply-${event.id}`, replyId: event.id, payload });

  const toast = new Promise<string>((resolve, reject) => {
    channel.listen((event) => {
      const { payload } = event;
      if (payload.type === "filter_text_request") {
        // Match the JSON transport used by the real plugin host.
        requests.push(JSON.parse(JSON.stringify(payload)) as InternalEventPayload);
        reply(
          event,
          payload.language === "jsonpath"
            ? { type: "filter_text_response", content: "[\n  1\n]" }
            : { type: "filter_text_response", content: "", error: "Invalid filter: bad" },
        );
      } else if (payload.type === "show_toast_request") {
        resolve(payload.message);
      } else if (payload.type === "error_response") {
        reject(new Error(payload.error));
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
    expect(JSON.parse(await toast)).toEqual([
      { content: "[\n  1\n]" },
      { content: "", error: "Invalid filter: bad" },
    ]);
    expect(requests).toEqual([
      { type: "filter_text_request", language: "jsonpath", text: '{"a":1}', query: "$.a" },
      { type: "filter_text_request", language: "xpath", text: "<a/>", query: "//b[" },
    ]);
  } finally {
    await instance.terminate();
    await rm(dir, { recursive: true, force: true });
  }
});
