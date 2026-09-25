import type { HttpRequest } from "@yaakapp-internal/models";
import { describe, expect, test, vi } from "vite-plus/test";
import { resolvedModelNameCases } from "./resolvedModelName.cases";

// resolvedModelName only reads plain model fields, but its module imports pull in the
// platform singleton, which needs a browser. Stub them out to keep this a pure unit test.
vi.mock("@yaakapp-internal/models", () => ({ foldersAtom: {} }));
vi.mock("./jotai", () => ({ jotaiStore: { get: () => [] } }));

const { resolvedModelName } = await import("./resolvedModelName");

function httpRequest(url: string, name = ""): HttpRequest {
  return { id: "rq_test", model: "http_request", name, url } as HttpRequest;
}

describe("resolvedModelName", () => {
  // Shared with the plugin's hand-copied scanner. See `resolvedModelName.cases.ts`.
  test.each(resolvedModelNameCases)("$name", ({ url, requestName, expected }) => {
    expect(resolvedModelName(httpRequest(url, requestName))).toEqual(expected);
  });
});
