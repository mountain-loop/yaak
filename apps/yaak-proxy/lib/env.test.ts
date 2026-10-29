import { describe, expect, test } from "vite-plus/test";
import { environmentExports } from "./env";

describe("environmentExports", () => {
  test("points the proxy variables at the port and the CA variables at the certificate", () => {
    const path = "/Users/me/Library/Application Support/app.yaak.proxy/ca/ca.pem";
    expect(environmentExports(9090, path)).toBe(
      [
        "export HTTP_PROXY=http://127.0.0.1:9090",
        "export HTTPS_PROXY=http://127.0.0.1:9090",
        "export http_proxy=http://127.0.0.1:9090",
        "export https_proxy=http://127.0.0.1:9090",
        `export SSL_CERT_FILE='${path}'`,
        `export NODE_EXTRA_CA_CERTS='${path}'`,
        `export REQUESTS_CA_BUNDLE='${path}'`,
      ].join("\n"),
    );
  });
});
