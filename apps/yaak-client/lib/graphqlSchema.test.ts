import { buildSchema, introspectionFromSchema } from "graphql";
import { describe, expect, test } from "vite-plus/test";
import { tryBuildIntrospectionFromFile } from "./graphqlSchema";

const sdl = `
  type Query {
    hello: String!
    user(id: ID!): User
  }

  type User {
    id: ID!
    name: String
  }
`;

const introspection = introspectionFromSchema(buildSchema(sdl));

describe("tryBuildIntrospectionFromFile", () => {
  test("accepts introspection JSON wrapped in { data: ... }", () => {
    const input = JSON.stringify({ data: introspection });
    const result = tryBuildIntrospectionFromFile(input);

    expect("schema" in result).toBe(true);
    if ("schema" in result) {
      expect(result.schema.getQueryType()?.getFields()).toHaveProperty("hello");
      // Output content is the normalized, persistable shape.
      expect(JSON.parse(result.content)).toHaveProperty("data.__schema");
    }
  });

  test("accepts bare introspection JSON without a data wrapper", () => {
    const input = JSON.stringify(introspection);
    const result = tryBuildIntrospectionFromFile(input);

    expect("schema" in result).toBe(true);
    if ("schema" in result) {
      expect(result.schema.getQueryType()?.getFields()).toHaveProperty("user");
      // Bare input is wrapped on the way out.
      expect(JSON.parse(result.content)).toHaveProperty("data.__schema");
    }
  });

  test("accepts a GraphQL SDL string", () => {
    const result = tryBuildIntrospectionFromFile(sdl);

    expect("schema" in result).toBe(true);
    if ("schema" in result) {
      const fields = result.schema.getQueryType()?.getFields() ?? {};
      expect(fields).toHaveProperty("hello");
      expect(fields).toHaveProperty("user");
      // SDL is converted to introspection JSON for storage.
      expect(JSON.parse(result.content)).toHaveProperty("data.__schema");
    }
  });

  test("returns an error for JSON that is neither introspection nor SDL", () => {
    const result = tryBuildIntrospectionFromFile('{"unrelated":"value"}');

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/Could not parse file as introspection JSON or GraphQL SDL/);
    }
  });

  test("returns an error for content that is neither valid JSON nor valid SDL", () => {
    const result = tryBuildIntrospectionFromFile("not a schema!@#$");

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/Could not parse file as introspection JSON or GraphQL SDL/);
    }
  });

  test("returns an error when introspection JSON has a malformed __schema", () => {
    // Has the data.__schema shape but the contents are invalid for buildClientSchema.
    const input = JSON.stringify({ data: { __schema: { broken: true } } });
    const result = tryBuildIntrospectionFromFile(input);

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/Failed to build schema from introspection JSON/);
    }
  });
});
