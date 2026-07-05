import { describe, expect, test } from "vite-plus/test";
import { isGraphQLJsonBody, parseGraphQLJsonBody } from "../src/graphql";

describe("isGraphQLJsonBody", () => {
  test("detects named query documents without a GraphQL URL", () => {
    const args = {
      mimeType: "application/json",
      text: JSON.stringify({
        query: "query Search($id: ID!) { node(id: $id) { id } }",
        variables: { id: "123" },
        operationName: "Search",
      }),
      url: "https://api.example.com/search",
    };

    expect(isGraphQLJsonBody(args)).toBe(true);
    expect(parseGraphQLJsonBody(args)).toEqual({
      query: "query Search($id: ID!) { node(id: $id) { id } }",
      variables: '{\n  "id": "123"\n}',
      operationName: "Search",
    });
  });

  test("detects mutation documents", () => {
    expect(
      isGraphQLJsonBody({
        mimeType: "application/json",
        text: JSON.stringify({ query: "mutation Save { saveThing { id } }" }),
        url: "https://api.example.com",
      }),
    ).toBe(true);
  });

  test("detects anonymous selection set documents", () => {
    expect(
      isGraphQLJsonBody({
        mimeType: "application/json",
        text: JSON.stringify({ query: "{ viewer { id email } }" }),
        url: "https://api.example.com",
      }),
    ).toBe(true);
  });

  test("detects document bodies on GraphQL-looking paths", () => {
    expect(
      isGraphQLJsonBody({
        mimeType: "application/json",
        text: JSON.stringify({ query: "query Search { viewer { id } }", operationName: "Search" }),
        url: "https://api.example.com/v1/graphql",
      }),
    ).toBe(true);
  });

  test("does not detect incomplete operation documents even on GraphQL-looking paths", () => {
    expect(
      isGraphQLJsonBody({
        mimeType: "application/json",
        text: JSON.stringify({ query: "query Search", operationName: "Search" }),
        url: "https://api.example.com/graphql",
      }),
    ).toBe(false);
  });

  test("does not detect plain JSON query fields even on GraphQL-looking paths", () => {
    expect(
      isGraphQLJsonBody({
        mimeType: "application/json",
        text: JSON.stringify({ query: "SearchQueryInput!" }),
        url: "https://api.example.com/graphql",
      }),
    ).toBe(false);
  });

  test("does not use variables and operationName alone as enough evidence", () => {
    expect(
      isGraphQLJsonBody({
        mimeType: "application/json",
        text: JSON.stringify({
          query: "SearchQueryInput!",
          variables: { id: "123" },
          operationName: "Search",
        }),
        url: "https://api.example.com",
      }),
    ).toBe(false);
  });

  test("detects bodies with string variables without parsing them", () => {
    const args = {
      mimeType: "application/json",
      text: JSON.stringify({
        query: "query Search($id: ID!) { node(id: $id) { id } }",
        variables: '{ "id": "123" }',
      }),
      url: "https://api.example.com",
    };

    expect(isGraphQLJsonBody(args)).toBe(true);
    expect(parseGraphQLJsonBody(args)).toEqual({
      query: "query Search($id: ID!) { node(id: $id) { id } }",
      variables: '{ "id": "123" }',
    });
  });

  test("does not detect GraphQL envelopes with extra fields", () => {
    const args = {
      mimeType: "application/json",
      text: JSON.stringify({
        query: "query Search($id: ID!) { node(id: $id) { id } }",
        variables: { id: "123" },
        extensions: { persistedQuery: { version: 1, sha256Hash: "abc123" } },
      }),
      url: "https://api.example.com/graphql",
    };

    expect(isGraphQLJsonBody(args)).toBe(false);
    expect(parseGraphQLJsonBody(args)).toBeNull();
  });

  test("ignores invalid JSON and non-object JSON", () => {
    expect(
      isGraphQLJsonBody({
        mimeType: "application/json",
        text: "not json",
        url: "https://api.example.com/graphql",
      }),
    ).toBe(false);
    expect(
      isGraphQLJsonBody({
        mimeType: "application/json",
        text: "[]",
        url: "https://api.example.com/graphql",
      }),
    ).toBe(false);
  });

  test("ignores non-JSON MIME types", () => {
    expect(
      isGraphQLJsonBody({
        mimeType: "text/plain",
        text: JSON.stringify({ query: "query Search { viewer { id } }" }),
        url: "https://api.example.com/graphql",
      }),
    ).toBe(false);
  });
});
