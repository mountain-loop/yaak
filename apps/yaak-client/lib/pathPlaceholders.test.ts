import { describe, expect, test } from "vite-plus/test";
import { extractPathPlaceholders } from "./pathPlaceholders";

describe("extractPathPlaceholders", () => {
  test("extracts a single placeholder", () => {
    expect(extractPathPlaceholders("/users/:id")).toEqual([":id"]);
  });

  test("extracts multiple placeholders", () => {
    expect(extractPathPlaceholders("/users/:id/posts/:postId")).toEqual([":id", ":postId"]);
  });

  test("stops at a literal `:` in the same segment", () => {
    expect(extractPathPlaceholders("/tasks/:id:cancel")).toEqual([":id"]);
  });

  test("does not match `:foo` mid-segment", () => {
    expect(extractPathPlaceholders("/users/abc:def")).toEqual([]);
  });

  test("does not match `:` in a host port", () => {
    expect(extractPathPlaceholders("https://example.com:8080/users/:id")).toEqual([":id"]);
  });

  test("returns empty for a URL with no placeholders", () => {
    expect(extractPathPlaceholders("https://example.com/foo/bar?q=1#hash")).toEqual([]);
  });
});
