import { describe, expect, test } from "vite-plus/test";
import { shellQuote, toCurl } from "./curl";

const headers = (...pairs: [string, string][]) => pairs.map(([name, value]) => ({ name, value }));

describe("toCurl", () => {
  test("a GET is the URL and its headers, without the ones curl sets itself", () => {
    const flow = {
      method: "GET",
      url: "https://api.github.com/repos/yaak?page=2",
      requestHeaders: headers(
        ["Host", "api.github.com"],
        ["Accept", "application/json"],
        ["Proxy-Connection", "keep-alive"],
        ["Connection", "keep-alive"],
      ),
    };
    expect(toCurl(flow, null)).toBe(
      "curl 'https://api.github.com/repos/yaak?page=2' \\\n  -H 'Accept: application/json'",
    );
  });

  test("a POST with a body leaves the method to curl and quotes the body", () => {
    const flow = {
      method: "POST",
      url: "https://api.stripe.com/v1/charges",
      requestHeaders: headers(
        ["Authorization", "Bearer sk_test_123"],
        ["Content-Type", "application/json"],
        ["Content-Length", "23"],
        ["Accept-Encoding", "gzip, br"],
      ),
    };
    expect(toCurl(flow, `{"note":"it's paid"}`)).toBe(
      [
        "curl 'https://api.stripe.com/v1/charges'",
        "-H 'Authorization: Bearer sk_test_123'",
        "-H 'Content-Type: application/json'",
        "--compressed",
        `--data-raw '{"note":"it'\\''s paid"}'`,
      ].join(" \\\n  "),
    );
  });

  test("quotes a method that is not a plain word, and drops the decoded body's encoding", () => {
    const flow = {
      method: "`id`",
      url: "https://x.test/a",
      requestHeaders: headers(["Content-Encoding", "gzip"], ["X-Trace", "1"]),
    };
    expect(toCurl(flow, "plain")).toBe(
      "curl -X '`id`' \\\n  'https://x.test/a' \\\n  -H 'X-Trace: 1' \\\n  --data-raw 'plain'",
    );
  });

  test("replays HEAD with --head and leaves brackets in the URL alone", () => {
    const flow = {
      method: "HEAD",
      url: "https://x.test/a?filter[status]=open",
      requestHeaders: [],
    };
    expect(toCurl(flow, null)).toBe(
      "curl --head \\\n  --globoff \\\n  'https://x.test/a?filter[status]=open'",
    );
  });

  test("names any other method", () => {
    const flow = { method: "DELETE", url: "https://x.test/a", requestHeaders: [] };
    expect(toCurl(flow, null)).toBe("curl -X DELETE \\\n  'https://x.test/a'");
    expect(toCurl({ ...flow, method: "GET" }, "q=1")).toBe(
      "curl -X GET \\\n  'https://x.test/a' \\\n  --data-raw 'q=1'",
    );
  });
});

describe("shellQuote", () => {
  test("closes and reopens the quotes around a quote", () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
    expect(shellQuote("$HOME `x`")).toBe("'$HOME `x`'");
  });
});
