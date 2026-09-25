import type { HttpRequest } from "@yaakapp-internal/models";
import { describe, expect, test, vi } from "vite-plus/test";

// resolvedModelName only reads plain model fields, but its module imports pull in the
// platform singleton, which needs a browser. Stub them out to keep this a pure unit test.
vi.mock("@yaakapp-internal/models", () => ({ foldersAtom: {} }));
vi.mock("./jotai", () => ({ jotaiStore: { get: () => [] } }));

const { resolvedModelName } = await import("./resolvedModelName");

function httpRequest(url: string): HttpRequest {
  return { id: "rq_test", model: "http_request", name: "", url } as HttpRequest;
}

describe("resolvedModelName", () => {
  test("returns the name when there is one", () => {
    expect(
      resolvedModelName({ ...httpRequest("https://example.com"), name: "My Request" }),
    ).toEqual("My Request");
  });

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

  test("falls back to a generic name when the url is empty", () => {
    expect(resolvedModelName(httpRequest(""))).toEqual("HTTP Request");
  });
});
