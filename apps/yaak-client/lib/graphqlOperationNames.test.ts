import { describe, expect, test } from "vite-plus/test";
import { getGraphQLOperationNames, parseGraphQLOperationNames } from "./graphqlOperationNames";

describe("getGraphQLOperationNames", () => {
  test("returns named operations from a GraphQL document", () => {
    expect(
      getGraphQLOperationNames(`
        query GetUser { user { id } }
        mutation UpdateUser { updateUser { id } }
        subscription UserChanged { userChanged { id } }
        fragment UserFields on User { id }
      `),
    ).toEqual(["GetUser", "UpdateUser", "UserChanged"]);
  });

  test("ignores anonymous operations", () => {
    expect(getGraphQLOperationNames(`{ user { id } }`)).toEqual([]);
  });

  test("returns unique operation names in document order", () => {
    expect(
      getGraphQLOperationNames(`
        query GetUser { user { id } }
        query GetUser { user { name } }
        query ListUsers { users { id } }
      `),
    ).toEqual(["GetUser", "ListUsers"]);
  });

  test("returns no operations for invalid in-progress documents", () => {
    expect(getGraphQLOperationNames(`query GetUser { user {`)).toEqual([]);
  });

  test("returns null when parsing invalid in-progress documents", () => {
    expect(parseGraphQLOperationNames(`query GetUser { user {`)).toBeNull();
  });
});
