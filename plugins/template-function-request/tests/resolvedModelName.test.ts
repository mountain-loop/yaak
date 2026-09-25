/*
 * This plugin carries its own copy of the template-tag scanner, because importing the client's
 * copy into the plugin bundle fails to build on Windows in CI.
 *
 * Rather than copying the expectations too — copied expectations can't detect drift — this
 * imports the client's `resolvedModelName.cases.ts` and runs the plugin's copy against it, then
 * asserts the plugin's output matches the client's own `resolvedModelName` for every case. A
 * change to the client scanner or its cases therefore fails here until the copy is updated. The
 * import is test-only and never reaches the plugin bundle, so the Windows problem doesn't apply.
 */

import type { HttpRequest } from "@yaakapp-internal/models";
import { describe, expect, test, vi } from "vite-plus/test";
import { resolvedModelNameCases } from "../../../apps/yaak-client/lib/resolvedModelName.cases";

// `resolvedModelName` reads plain model fields, but the two modules under test pull in sibling
// plugins that only resolve once they're built, plus the client's platform singleton, which
// needs a browser. Stub them all out to keep this a pure unit test.
vi.mock("../../template-function-json", () => ({ filterJSONPath: () => null }));
vi.mock("../../template-function-xml", () => ({ filterXPath: () => null }));
vi.mock("@yaakapp-internal/models", () => ({ foldersAtom: {} }));
vi.mock("../../../apps/yaak-client/lib/jotai", () => ({ jotaiStore: { get: () => [] } }));

const { resolvedModelName } = await import("../src");
const { resolvedModelName: clientResolvedModelName } = await import(
  "../../../apps/yaak-client/lib/resolvedModelName"
);

function httpRequest(url: string, name = ""): HttpRequest {
  return { id: "rq_test", model: "http_request", name, url } as HttpRequest;
}

describe("resolvedModelName", () => {
  test.each(resolvedModelNameCases)("$name", ({ url, requestName, expected }) => {
    expect(resolvedModelName(httpRequest(url, requestName))).toEqual(expected);
  });

  test.each(resolvedModelNameCases)("matches the client for: $name", ({ url, requestName }) => {
    const request = httpRequest(url, requestName);
    expect(resolvedModelName(request)).toEqual(clientResolvedModelName(request));
  });
});
