/* oxlint-disable no-template-curly-in-string */

/*
 * Shared expectations for `resolvedModelName`.
 *
 * The request template function plugin carries a hand-copied `resolvedModelName` and template-tag
 * scanner, because importing this module into the plugin bundle fails to build on Windows in CI.
 * Both `resolvedModelName.test.ts` here and `plugins/template-function-request/tests/
 * resolvedModelName.test.ts` iterate these cases, so changing an expectation on this side
 * automatically exercises the plugin's copy and a drifting copy fails its own suite.
 *
 * Keep this file dependency-free — the plugin test imports it by relative path, so anything it
 * pulls in would have to resolve from both packages.
 */

export interface ResolvedModelNameCase {
  /** Test name, used as the `test.each` title on both sides. */
  name: string;
  /** `url` of the `http_request` under test. */
  url: string;
  /** `name` of the `http_request`, when the case is about an explicit name. */
  requestName?: string;
  /** What `resolvedModelName` must return. */
  expected: string;
}

export const resolvedModelNameCases: ResolvedModelNameCase[] = [
  {
    name: "returns the name when there is one",
    url: "https://example.com",
    requestName: "My Request",
    expected: "My Request",
  },
  {
    name: "replaces a simple tag with its contents",
    url: "${[ base_url ]}/users",
    expected: "base_url/users",
  },
  {
    name: "replaces a tag containing a quoted argument with a space",
    url: "${[ fn(arg='my key') ]}/users",
    expected: "fn(arg='my key')/users",
  },
  {
    name: "replaces each tag in a multi-tag string",
    url: "${[ fn(arg='my key') ]}/a/${[ other(b='x y') ]}/b",
    expected: "fn(arg='my key')/a/other(b='x y')/b",
  },
  {
    name: "keeps a quoted `]}` inside the tag",
    url: "${[ fn(arg='x]}y') ]}/users",
    expected: "fn(arg='x]}y')/users",
  },
  {
    name: "keeps an escaped quote inside the tag",
    url: "${[ fn(arg='it\\'s ]}') ]}/users",
    expected: "fn(arg='it\\'s ]}')/users",
  },
  {
    name: "closes at the first `]}` when a quote is left unterminated",
    url: "${[ fn(arg='oops ]}/users",
    expected: "fn(arg='oops/users",
  },
  {
    name: "stops each tag at its first closing bracket",
    url: "${[ a ]}${[ b ]}",
    expected: "ab",
  },
  {
    name: "strips the protocol",
    url: "https://example.com/${[ path ]}",
    expected: "example.com/path",
  },
  {
    name: "falls back to a generic name when the url is empty",
    url: "",
    expected: "HTTP Request",
  },
];
