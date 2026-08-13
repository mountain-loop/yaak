import { describe, expect, test } from "vite-plus/test";
import { importHttpBodyAndHeaders } from "../src/common";

describe("importHttpBodyAndHeaders", () => {
  test("imports XML text using the native XML body type", () => {
    const result = importHttpBodyAndHeaders({
      body: {
        mimeType: "application/soap+xml; charset=utf-8",
        text: "<soap:Envelope />",
      },
    });

    expect(result).toEqual({
      bodyType: "text/xml",
      body: { text: "<soap:Envelope />" },
      headers: [
        {
          enabled: true,
          name: "Content-Type",
          value: "application/soap+xml; charset=utf-8",
        },
      ],
    });
  });

  test("imports vendor JSON using the native JSON body type", () => {
    const result = importHttpBodyAndHeaders({
      body: {
        mimeType: "application/problem+json",
        text: '{"message":"Nope"}',
      },
    });

    expect(result.bodyType).toBe("application/json");
    expect(result.body).toEqual({ text: '{"message":"Nope"}' });
  });

  test("imports unknown text using the other body type", () => {
    const result = importHttpBodyAndHeaders({
      body: {
        mimeType: "application/yaml",
        text: "message: hello",
      },
    });

    expect(result).toEqual({
      bodyType: "other",
      body: { text: "message: hello" },
      headers: [
        {
          enabled: true,
          name: "Content-Type",
          value: "application/yaml",
        },
      ],
    });
  });

  test("preserves an explicit content type instead of adding a duplicate", () => {
    const result = importHttpBodyAndHeaders({
      body: {
        mimeType: "application/yaml",
        text: "message: hello",
      },
      headers: [
        {
          name: "content-type",
          value: "application/x-yaml",
        },
      ],
    });

    expect(result.headers).toEqual([
      {
        enabled: true,
        name: "content-type",
        value: "application/x-yaml",
      },
    ]);
  });

  test("imports text without inventing a content type", () => {
    const result = importHttpBodyAndHeaders({ body: { text: "hello" } });

    expect(result).toEqual({
      bodyType: "other",
      body: { text: "hello" },
      headers: [],
    });
  });
});
