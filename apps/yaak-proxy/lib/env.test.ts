import { describe, expect, test } from "vite-plus/test";
import { defaultShell, environmentBlock, environmentExports } from "./env";

const MAC_PATH = "/Users/me/Library/Application Support/app.yaak.proxy/ca/ca.pem";

describe("environmentExports", () => {
  test("points the proxy variables at the port and the CA variables at the certificate", () => {
    expect(environmentExports(9090, MAC_PATH)).toBe(
      [
        "export HTTP_PROXY=http://127.0.0.1:9090",
        "export HTTPS_PROXY=http://127.0.0.1:9090",
        "export http_proxy=http://127.0.0.1:9090",
        "export https_proxy=http://127.0.0.1:9090",
        `export SSL_CERT_FILE='${MAC_PATH}'`,
        `export NODE_EXTRA_CA_CERTS='${MAC_PATH}'`,
        `export REQUESTS_CA_BUNDLE='${MAC_PATH}'`,
      ].join("\n"),
    );
  });
});

describe("environmentBlock", () => {
  test("bash and zsh quote only what needs it", () => {
    const lines = environmentBlock("posix", 9090, "/tmp/it's.pem").split("\n");
    expect(lines[0]).toBe("export HTTP_PROXY=http://127.0.0.1:9090");
    expect(lines[4]).toBe(`export SSL_CERT_FILE='/tmp/it'\\''s.pem'`);
  });

  test("fish", () => {
    const lines = environmentBlock("fish", 8080, MAC_PATH).split("\n");
    expect(lines[0]).toBe("set -gx HTTP_PROXY http://127.0.0.1:8080");
    expect(lines[6]).toBe(`set -gx REQUESTS_CA_BUNDLE '${MAC_PATH}'`);
    expect(environmentBlock("fish", 1, "/a b/it's\\x").split("\n")[4]).toBe(
      `set -gx SSL_CERT_FILE '/a b/it\\'s\\\\x'`,
    );
  });

  test("PowerShell", () => {
    const path = "C:\\Users\\O'Neil\\AppData\\Roaming\\app.yaak.proxy\\ca.pem";
    const lines = environmentBlock("powershell", 9090, path).split("\n");
    expect(lines[1]).toBe("$env:HTTPS_PROXY = 'http://127.0.0.1:9090'");
    expect(lines[5]).toBe(
      "$env:NODE_EXTRA_CA_CERTS = 'C:\\Users\\O''Neil\\AppData\\Roaming\\app.yaak.proxy\\ca.pem'",
    );
  });

  test("cmd", () => {
    const path = "C:\\Program Files\\Yaak\\ca.pem";
    const lines = environmentBlock("cmd", 9090, path).split("\n");
    expect(lines[0]).toBe(`set "HTTP_PROXY=http://127.0.0.1:9090"`);
    expect(lines[4]).toBe(`set "SSL_CERT_FILE=${path}"`);
  });

  test("names every variable a tool reads", () => {
    const block = environmentBlock("posix", 9090, "/ca.pem");
    for (const name of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "SSL_CERT_FILE",
      "NODE_EXTRA_CA_CERTS",
      "REQUESTS_CA_BUNDLE",
    ]) {
      expect(block).toContain(`export ${name}=`);
    }
  });
});

describe("defaultShell", () => {
  test("by the platform", () => {
    expect(defaultShell("macos")).toBe("posix");
    expect(defaultShell("linux")).toBe("posix");
    expect(defaultShell("windows")).toBe("powershell");
    expect(defaultShell(null)).toBe("posix");
  });
});
