import type { Context } from "@yaakapp/api";
import type { HttpRequest } from "@yaakapp-internal/models";
import { describe, expect, it, vi } from "vite-plus/test";

// The plugin pulls in sibling plugins that only resolve once they're built
vi.mock("../../template-function-json", () => ({ filterJSONPath: () => null }));
vi.mock("../../template-function-xml", () => ({ filterXPath: () => null }));

const { plugin } = await import("../src");

const request = {
  id: "rq_test",
  model: "http_request",
  headers: [
    { name: "Authorization", value: "Bearer old", enabled: false },
    { name: "Authorization", value: "Bearer new", enabled: true },
    { name: "X-Debug", value: "1", enabled: false },
    { name: "X-Legacy", value: "legacy" },
  ],
} as HttpRequest;

const ctx = {
  httpRequest: { getById: async () => request },
  templates: { render: async ({ data }: { data: string }) => data },
} as unknown as Context;

describe("request.header", () => {
  const headerFunction = plugin.templateFunctions?.find((f) => f.name === "request.header");

  const readHeader = async (header: string) =>
    await headerFunction?.onRender(ctx, {
      values: { requestId: request.id, header },
      purpose: "send",
    });

  it("skips a disabled header with the same name", async () => {
    expect(await readHeader("Authorization")).toBe("Bearer new");
    expect(await readHeader("authorization")).toBe("Bearer new");
  });

  it("returns an empty string when the header is only present as disabled", async () => {
    expect(await readHeader("X-Debug")).toBe("");
  });

  it("reads a header without an enabled flag", async () => {
    expect(await readHeader("X-Legacy")).toBe("legacy");
  });
});
