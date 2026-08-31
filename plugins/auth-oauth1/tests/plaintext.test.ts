import { describe, expect, test } from "vite-plus/test";
import { plugin } from "../src";

function sign(values: Record<string, string>): string {
  const result = plugin.authentication!.onApply!(
    {} as never,
    {
      values,
      method: "GET",
      url: "https://api.example.com/resource",
    } as never,
  ) as { setHeaders: { name: string; value: string }[] };
  const header = result.setHeaders[0]!.value;
  const match = header.match(/oauth_signature="([^"]*)"/);
  return decodeURIComponent(match![1]!);
}

describe("PLAINTEXT signature", () => {
  const base = {
    signatureMethod: "PLAINTEXT",
    consumerKey: "ck",
    consumerSecret: "cs",
    nonce: "abc123",
    timestamp: "1700000000",
  };

  // RFC 5849 3.4.4: the PLAINTEXT signature is the signing key itself --
  // encoded(consumer secret) "&" encoded(token secret) -- not the base string.
  test("is the signing key, not the signature base string", () => {
    expect(sign({ ...base, tokenKey: "tk", tokenSecret: "ts" })).toBe("cs&ts");
  });

  test("keeps the trailing separator when there is no token secret", () => {
    expect(sign(base)).toBe("cs&");
  });

  test("includes the token secret without an access token, omitting oauth_token", () => {
    const result = plugin.authentication!.onApply!(
      {} as never,
      {
        values: { ...base, tokenSecret: "ts" },
        method: "GET",
        url: "https://api.example.com/resource",
      } as never,
    ) as { setHeaders: { name: string; value: string }[] };
    const header = result.setHeaders[0]!.value;
    const match = header.match(/oauth_signature="([^"]*)"/);
    expect(decodeURIComponent(match![1]!)).toBe("cs&ts");
    expect(header).not.toContain("oauth_token=");
  });

  test("percent-encodes reserved characters in the secrets", () => {
    expect(sign({ ...base, consumerSecret: "c s", tokenKey: "tk", tokenSecret: "t&s" })).toBe(
      "c%20s&t%26s",
    );
  });
});
