import { describe, expect, test } from "vite-plus/test";
import type { JsonSchema } from "./jsonSchemaExample";
import { buildExampleFromSchema } from "./jsonSchemaExample";

describe("buildExampleFromSchema", () => {
  test("fills scalar fields with placeholders", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number", format: "int32" },
        active: { type: "boolean" },
        data: { type: "string", format: "byte" },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({
      name: "",
      age: 0,
      active: false,
      data: "",
    });
  });

  test("encodes 64-bit integers as strings", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        id: { type: "string", format: "int64" },
        count: { type: "string", format: "uint64" },
        offset: { type: "string", format: "sfixed64" },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({ id: "0", count: "0", offset: "0" });
  });

  test("fills date-time with a parseable timestamp", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { createdAt: { type: "string", format: "date-time" } },
    };

    const example = buildExampleFromSchema(schema) as { createdAt: string };
    expect(Number.isNaN(Date.parse(example.createdAt))).toBe(false);
  });

  test("fills a duration with a value that parses", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { timeout: { type: "string", format: "duration" } },
    };

    // An empty string fails protobuf's Duration parsing, so the message wouldn't send
    expect(buildExampleFromSchema(schema)).toEqual({ timeout: "0s" });
  });

  test("expands nested messages through $defs", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { user: { $ref: "#/$defs/example.User" } },
      $defs: {
        "example.User": {
          type: "object",
          properties: {
            name: { type: "string" },
            address: { $ref: "#/$defs/example.Address" },
          },
        },
        "example.Address": {
          type: "object",
          properties: { city: { type: "string" } },
        },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({
      user: { name: "", address: { city: "" } },
    });
  });

  test("gives repeated fields a single placeholder item", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        users: { type: "array", items: { $ref: "#/$defs/example.User" } },
        unknown: { type: "array" },
      },
      $defs: {
        "example.User": { type: "object", properties: { name: { type: "string" } } },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({
      tags: [""],
      users: [{ name: "" }],
      unknown: [],
    });
  });

  test("uses the first value of an enum", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["STATUS_UNSPECIFIED", "STATUS_ACTIVE"] },
        empty: { type: "string", enum: [] },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({ status: "STATUS_UNSPECIFIED", empty: "" });
  });

  test("gives maps a single placeholder entry", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        labels: { type: "object", additionalProperties: { type: "string" } },
        users: { type: "object", additionalProperties: { $ref: "#/$defs/example.User" } },
      },
      $defs: {
        "example.User": { type: "object", properties: { name: { type: "string" } } },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({
      labels: { key: "" },
      users: { key: { name: "" } },
    });
  });

  test("stops at the root self-reference", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        value: { type: "string" },
        children: { type: "array", items: { $ref: "#" } },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({ value: "", children: [{}] });
  });

  test("stops at a cycle between messages", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { node: { $ref: "#/$defs/example.Node" } },
      $defs: {
        "example.Node": {
          type: "object",
          properties: {
            name: { type: "string" },
            parent: { $ref: "#/$defs/example.Node" },
            leaf: { $ref: "#/$defs/example.Leaf" },
          },
        },
        "example.Leaf": {
          type: "object",
          properties: { node: { $ref: "#/$defs/example.Node" } },
        },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({
      node: { name: "", parent: {}, leaf: { node: {} } },
    });
  });

  test("expands the same message twice when it is not on the same path", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        from: { $ref: "#/$defs/example.User" },
        to: { $ref: "#/$defs/example.User" },
      },
      $defs: {
        "example.User": { type: "object", properties: { name: { type: "string" } } },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({ from: { name: "" }, to: { name: "" } });
  });

  test("fills every branch of a flattened oneof", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        image: { $ref: "#/$defs/example.Image" },
      },
      $defs: {
        "example.Image": { type: "object", properties: { url: { type: "string" } } },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({
      id: "",
      text: "",
      image: { url: "" },
    });
  });

  test("stops expanding once the node budget runs out", () => {
    // Every level references the next one twice, so an unbounded walk would build 2^depth
    // nodes without ever repeating a ref on the same path.
    const depth = 16;
    const $defs: Record<string, JsonSchema> = { [`d${depth}`]: { type: "string" } };
    for (let i = 0; i < depth; i++) {
      $defs[`d${i}`] = {
        type: "object",
        properties: {
          a: { $ref: `#/$defs/d${i + 1}` },
          b: { $ref: `#/$defs/d${i + 1}` },
        },
      };
    }

    const example = buildExampleFromSchema({
      type: "object",
      properties: { root: { $ref: "#/$defs/d0" } },
      $defs,
    });

    // 2 ** 16 nodes unbounded; the budget holds it to a couple of thousand
    expect(countNodes(example)).toBeLessThan(10_000);
  });

  test("handles messages without a known type", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        empty: {},
        struct: { type: "object" },
        missing: { $ref: "#/$defs/example.Nope" },
      },
    };

    expect(buildExampleFromSchema(schema)).toEqual({ empty: null, struct: {}, missing: {} });
  });
});

function countNodes(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + value.reduce((total: number, v) => total + countNodes(v), 0);
  }
  if (value !== null && typeof value === "object") {
    return 1 + Object.values(value).reduce((total: number, v) => total + countNodes(v), 0);
  }
  return 1;
}
