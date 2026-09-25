/* oxlint-disable no-template-curly-in-string */

/*
 * This plugin carries its own copy of the template-tag scanner, because importing the client's
 * copy fails to build on Windows in CI. These cases are the same inputs and expected outputs as
 * `apps/yaak-client/lib/resolvedModelName.test.ts`, so the two copies drifting apart fails here.
 */

import type { HttpRequest } from "@yaakapp-internal/models";
import { describe, expect, test, vi } from "vite-plus/test";

// `resolvedModelName` reads plain model fields, but its module pulls in two sibling plugins
// that only resolve once they're built. Stub them out to keep this a pure unit test.
vi.mock("../../template-function-json", () => ({ filterJSONPath: () => null }));
vi.mock("../../template-function-xml", () => ({ filterXPath: () => null }));

const { resolvedModelName } = await import("../src");

function httpRequest(url: string): HttpRequest {
  return { id: "rq_test", model: "http_request", name: "", url } as HttpRequest;
}

describe("resolvedModelName", () => {
  test("replaces a simple tag with its contents", () => {
    expect(resolvedModelName(httpRequest("${[ base_url ]}/users"))).toEqual("base_url/users");
  });

  test("replaces a tag containing a quoted argument with a space", () => {
    expect(resolvedModelName(httpRequest("${[ fn(arg='my key') ]}/users"))).toEqual(
      "fn(arg='my key')/users",
    );
  });

  test("replaces each tag in a multi-tag string", () => {
    expect(
      resolvedModelName(httpRequest("${[ fn(arg='my key') ]}/a/${[ other(b='x y') ]}/b")),
    ).toEqual("fn(arg='my key')/a/other(b='x y')/b");
  });

  test("keeps a quoted `]}` inside the tag", () => {
    expect(resolvedModelName(httpRequest("${[ fn(arg='x]}y') ]}/users"))).toEqual(
      "fn(arg='x]}y')/users",
    );
  });

  test("keeps an escaped quote inside the tag", () => {
    expect(resolvedModelName(httpRequest("${[ fn(arg='it\\'s ]}') ]}/users"))).toEqual(
      "fn(arg='it\\'s ]}')/users",
    );
  });

  test("closes at the first `]}` when a quote is left unterminated", () => {
    expect(resolvedModelName(httpRequest("${[ fn(arg='oops ]}/users"))).toEqual(
      "fn(arg='oops/users",
    );
  });

  test("stops each tag at its first closing bracket", () => {
    expect(resolvedModelName(httpRequest("${[ a ]}${[ b ]}"))).toEqual("ab");
  });

  test("strips the protocol", () => {
    expect(resolvedModelName(httpRequest("https://example.com/${[ path ]}"))).toEqual(
      "example.com/path",
    );
  });

  test("returns the name when there is one", () => {
    expect(
      resolvedModelName({ ...httpRequest("https://example.com"), name: "My Request" }),
    ).toEqual("My Request");
  });

  test("falls back to a generic name when the url is empty", () => {
    expect(resolvedModelName(httpRequest(""))).toEqual("HTTP Request");
  });
});
