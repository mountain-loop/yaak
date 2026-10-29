import { shellQuote } from "./curl";

/**
 * Shell exports that send one terminal's traffic through the proxy on `port` and trust its CA at
 * `caPath`, for tools that read neither the system proxy nor the login keychain: Node, Python,
 * and anything built on OpenSSL.
 */
export function environmentExports(port: number, caPath: string): string {
  const proxy = `http://127.0.0.1:${port}`;
  const ca = shellQuote(caPath);
  return [
    `export HTTP_PROXY=${proxy}`,
    `export HTTPS_PROXY=${proxy}`,
    // curl reads only the lowercase name for plain HTTP.
    `export http_proxy=${proxy}`,
    `export https_proxy=${proxy}`,
    `export SSL_CERT_FILE=${ca}`,
    `export NODE_EXTRA_CA_CERTS=${ca}`,
    `export REQUESTS_CA_BUNDLE=${ca}`,
  ].join("\n");
}
