import { describe, expect, test } from "vite-plus/test";
import {
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_GRAPHQL,
  BODY_TYPE_JSON,
  BODY_TYPE_OTHER,
  BODY_TYPE_XML,
} from "./model_util";
import { convertRequestBody } from "./requestBodyConversion";

describe("convertRequestBody", () => {
  test("converts imported JSON GraphQL bodies to GraphQL shape", () => {
    const body = convertRequestBody({
      fromBodyType: BODY_TYPE_JSON,
      toBodyType: BODY_TYPE_GRAPHQL,
      body: {
        text: JSON.stringify({
          query: "query GetUser($id: ID!) { user(id: $id) { name } }",
          variables: { id: "123" },
          operationName: "GetUser",
        }),
      },
    });

    expect(body).toEqual({
      query: "query GetUser($id: ID!) { user(id: $id) { name } }",
      variables: '{\n  "id": "123"\n}',
      operationName: "GetUser",
    });
  });

  test("converts GraphQL bodies to JSON text", () => {
    const body = convertRequestBody({
      fromBodyType: BODY_TYPE_GRAPHQL,
      toBodyType: BODY_TYPE_JSON,
      body: {
        query: "query GetUser($id: ID!) { user(id: $id) { name } }",
        variables: '{ "id": "123" }',
        operationName: "GetUser",
      },
    });

    expect(body).toEqual({
      text: JSON.stringify(
        {
          query: "query GetUser($id: ID!) { user(id: $id) { name } }",
          variables: { id: "123" },
          operationName: "GetUser",
        },
        null,
        2,
      ),
    });
  });

  test("converts urlencoded forms to urlencoded text for text-like bodies", () => {
    const body = convertRequestBody({
      fromBodyType: BODY_TYPE_FORM_URLENCODED,
      toBodyType: BODY_TYPE_OTHER,
      body: {
        form: [
          { enabled: true, name: "basic", value: "aaa" },
          { enabled: true, name: "funky stuff", value: "*)%&#$)@ *$#)@&" },
          { enabled: false, name: "disabled", value: "hidden" },
          { enabled: true, name: "", value: "unnamed" },
        ],
      },
    });

    expect(body).toEqual({
      text: "basic=aaa&funky+stuff=*%29%25%26%23%24%29%40+*%24%23%29%40%26",
    });
  });

  test("converts urlencoded forms to JSON text for JSON bodies", () => {
    const body = convertRequestBody({
      fromBodyType: BODY_TYPE_FORM_URLENCODED,
      toBodyType: BODY_TYPE_JSON,
      body: {
        form: [
          { enabled: true, name: "tag", value: "one" },
          { enabled: true, name: "tag", value: "two" },
          { enabled: true, name: "limit", value: "10" },
        ],
      },
    });

    expect(body).toEqual({
      text: JSON.stringify({ tag: ["one", "two"], limit: "10" }, null, 2),
    });
  });

  test("does not convert XML text to form pairs", () => {
    const body = convertRequestBody({
      fromBodyType: BODY_TYPE_XML,
      toBodyType: BODY_TYPE_FORM_URLENCODED,
      body: { text: "a=1&b=two+words" },
    });

    expect(body).toEqual({
      form: [],
    });
  });
});
