import { describe, expect, test } from "vite-plus/test";
import { unnamedRequestName } from "./resolvedModelName";

describe("unnamedRequestName", () => {
  test("is the URL without its protocol, as Yaak shows an unnamed request", () => {
    const url = "http://ocsp2.apple.com/ocsp04-wwdrg312/ME4wTKADAgEAMEUwQzBBMAkGBSsOAwIaBQAEFA";
    expect(unnamedRequestName({ model: "http_request", url })).toBe(
      "ocsp2.apple.com/ocsp04-wwdrg312/ME4wTKADAgEAMEUwQzBBMAkGBSsOAwIaBQAEFA",
    );
  });

  test("names the kind of request when there is no URL", () => {
    expect(unnamedRequestName({ model: "http_request", url: "" })).toBe("HTTP Request");
    expect(unnamedRequestName({ model: "http_request", url: " ", bodyType: "graphql" })).toBe(
      "GraphQL Request",
    );
  });
});
