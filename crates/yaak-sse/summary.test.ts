import { describe, expect, it } from "vitest";
import { computeSseSummary, extractSseValueAtPath } from "./summary";

describe("extractSseValueAtPath", () => {
  it("supports simple paths", () => {
    expect(
      extractSseValueAtPath(
        JSON.stringify({ choices: [{ delta: { content: "hello" } }] }),
        "$.choices[0].delta.content",
      ),
    ).toBe("hello");
  });

  it("supports full JSONPath expressions", () => {
    expect(
      extractSseValueAtPath(
        JSON.stringify({
          choices: [
            { delta: { role: "assistant" } },
            { delta: { content: "hello" } },
            { delta: { content: " world" } },
          ],
        }),
        "$.choices[*].delta.content",
      ),
    ).toBe("hello world");
  });

  it("returns null when a JSONPath expression has no matches", () => {
    expect(extractSseValueAtPath(JSON.stringify({ delta: {} }), "$.delta.text")).toBeNull();
  });
});

describe("computeSseSummary", () => {
  it("concatenates JSONPath matches across SSE messages", () => {
    expect(
      computeSseSummary(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}`,
          "",
          `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}`,
          "",
        ].join("\n"),
        "$.choices[*].delta.content",
      ),
    ).toEqual({
      fragmentCount: 2,
      summary: "hello world",
    });
  });
});
