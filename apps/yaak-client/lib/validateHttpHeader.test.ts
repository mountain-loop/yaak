import { describe, expect, test } from "vite-plus/test";
import { validateHttpHeader } from "./validateHttpHeader";

describe("validateHttpHeader", () => {
  test("allows an empty value", () => {
    expect(validateHttpHeader("")).toEqual(true);
  });

  test("allows a plain header name", () => {
    expect(validateHttpHeader("X-Api-Key")).toEqual(true);
  });

  test("rejects a header name with a space", () => {
    expect(validateHttpHeader("X Api Key")).toEqual(false);
  });

  test("allows a simple template tag", () => {
    expect(validateHttpHeader("${[ my_var ]}")).toEqual(true);
  });

  test("allows a tag containing a quoted argument with a space", () => {
    expect(validateHttpHeader("${[ fn(arg='my key') ]}")).toEqual(true);
  });

  test("allows a multi-tag value", () => {
    expect(validateHttpHeader("${[ fn(arg='my key') ]}-${[ other(b='x y') ]}")).toEqual(true);
  });

  test("allows a tag whose quoted argument contains `]}`", () => {
    expect(validateHttpHeader("${[ fn(arg='x]}y') ]}")).toEqual(true);
  });

  test("allows a tag whose quoted argument contains an escaped quote", () => {
    expect(validateHttpHeader("${[ fn(arg='it\\'s ]}') ]}")).toEqual(true);
  });

  test("rejects a tag with a quoted `]}` followed by an invalid character", () => {
    expect(validateHttpHeader("${[ fn(arg='x]}y') ]} oops")).toEqual(false);
  });

  test("rejects a tag followed by an invalid character", () => {
    expect(validateHttpHeader("${[ my_var ]} oops")).toEqual(false);
  });
});
