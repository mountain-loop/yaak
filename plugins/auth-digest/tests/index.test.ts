import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "@yaakapp/api";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { plugin } from "../src";

function apply(ctx: Context, values: Record<string, string>, over: Partial<ApplyArgs> = {}) {
  return plugin.authentication!.onApply(ctx, {
    values,
    headers: [],
    url: "https://example.org/dir/index.html?a=b",
    method: "GET",
    body: null,
    contextId: "ctx",
    ...over,
  });
}

type ApplyArgs = Parameters<NonNullable<typeof plugin.authentication>["onApply"]>[1];

function ctxRespondingWith(headers: Array<{ name: string; value: string }>): {
  ctx: Context;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn().mockResolvedValue({ httpResponse: { headers } });
  return { ctx: { httpRequest: { send } } as unknown as Context, send };
}

describe("auth-digest onApply", () => {
  test("probes with the same method and URL, without credentials or body", async () => {
    const { ctx, send } = ctxRespondingWith([
      { name: "WWW-Authenticate", value: 'Digest realm="r", nonce="n", qop=auth' },
    ]);

    await apply(ctx, { username: "user", password: "pass" }, { method: "POST", body: "hello" });

    expect(send).toHaveBeenCalledWith({
      httpRequest: { method: "POST", url: "https://example.org/dir/index.html?a=b" },
    });
  });

  test("signs the request-target rather than the whole URL", async () => {
    const { ctx } = ctxRespondingWith([
      { name: "WWW-Authenticate", value: 'Digest realm="r", nonce="n", qop=auth' },
    ]);

    const result = await apply(ctx, { username: "user", password: "pass" });

    expect(result.setHeaders?.[0]?.name).toEqual("Authorization");
    expect(result.setHeaders?.[0]?.value).toContain('uri="/dir/index.html?a=b"');
  });

  test("uses a fresh cnonce on every apply", async () => {
    const { ctx } = ctxRespondingWith([
      { name: "WWW-Authenticate", value: 'Digest realm="r", nonce="n", qop=auth' },
    ]);

    const first = await apply(ctx, { username: "user", password: "pass" });
    const second = await apply(ctx, { username: "user", password: "pass" });

    expect(first.setHeaders?.[0]?.value).not.toEqual(second.setHeaders?.[0]?.value);
  });

  test("treats missing credentials as empty strings", async () => {
    const { ctx } = ctxRespondingWith([
      { name: "www-authenticate", value: 'Digest realm="r", nonce="n"' },
    ]);

    expect((await apply(ctx, {})).setHeaders?.[0]?.value).toContain('username=""');
  });

  test("fails clearly when the server does not offer Digest", async () => {
    const { ctx } = ctxRespondingWith([{ name: "WWW-Authenticate", value: 'Basic realm="r"' }]);

    await expect(apply(ctx, { username: "user", password: "pass" })).rejects.toThrow(
      "Server did not offer Digest authentication. It offered: Basic",
    );
  });

  test("selects the realm the user configured", async () => {
    const { ctx } = ctxRespondingWith([
      { name: "WWW-Authenticate", value: 'Digest realm="one", nonce="n1"' },
      { name: "WWW-Authenticate", value: 'Digest realm="two", nonce="n2"' },
    ]);

    expect(
      (await apply(ctx, { username: "user", password: "pass", realm: "two" })).setHeaders?.[0]
        ?.value,
    ).toContain('nonce="n2"');
  });
});

/**
 * A minimally correct Digest server, hashing inline rather than through the
 * plugin's own helpers so the round trip can't agree with itself on a mistake.
 */
function startDigestServer(config: {
  username: string;
  password: string;
  realm: string;
  nonce: string;
  algorithm?: string;
  qop?: string;
  /** Offer a second, unrelated realm ahead of the real one. */
  decoyRealm?: string;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const hashName = (config.algorithm ?? "MD5").toLowerCase().startsWith("sha-256")
    ? "sha256"
    : "md5";
  const sess = (config.algorithm ?? "").toLowerCase().endsWith("-sess");
  const hash = (value: string) => createHash(hashName).update(value, "utf8").digest("hex");

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const authorization = req.headers.authorization;
      if (authorization == null || !authorization.startsWith("Digest ")) {
        const challenge = [
          `Digest realm="${config.realm}"`,
          `nonce="${config.nonce}"`,
          `algorithm=${config.algorithm ?? "MD5"}`,
          config.qop == null ? null : `qop="${config.qop}"`,
          'opaque="0p4qu3"',
        ]
          .filter(Boolean)
          .join(", ");
        res.setHeader(
          "WWW-Authenticate",
          config.decoyRealm == null
            ? [challenge]
            : [
                `Digest realm="${config.decoyRealm}", nonce="wrong-nonce", algorithm=MD5`,
                challenge,
              ],
        );
        res.writeHead(401).end("unauthorized");
        return;
      }

      const params: Record<string, string> = {};
      for (const [, name, quoted, bare] of authorization
        .slice("Digest ".length)
        .matchAll(/([A-Za-z0-9*-]+)=(?:"((?:[^"\\]|\\.)*)"|([^,\s]*))/g)) {
        params[name!.toLowerCase()] = (quoted ?? bare ?? "").replace(/\\(.)/g, "$1");
      }

      const secret = hash(`${config.username}:${config.realm}:${config.password}`);
      const ha1 = sess ? hash(`${secret}:${params.nonce}:${params.cnonce}`) : secret;
      const ha2 =
        params.qop === "auth-int"
          ? hash(`${req.method}:${params.uri}:${hash(Buffer.concat(chunks).toString("utf8"))}`)
          : hash(`${req.method}:${params.uri}`);
      const expected =
        params.qop == null
          ? hash(`${ha1}:${params.nonce}:${ha2}`)
          : hash(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`);

      const ok =
        params.username === config.username &&
        params.realm === config.realm &&
        params.nonce === config.nonce &&
        params.uri === req.url &&
        params.opaque === "0p4qu3" &&
        params.response === expected;

      res.writeHead(ok ? 200 : 401).end(ok ? "welcome" : "denied");
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** Sends for real, so the plugin sees the headers a live server actually returns. */
function realContext(): Context {
  return {
    httpRequest: {
      async send({ httpRequest }: { httpRequest: { method?: string; url?: string } }) {
        const res = await fetch(httpRequest.url!, { method: httpRequest.method });
        await res.text();
        return {
          httpResponse: {
            headers: [...res.headers].map(([name, value]) => ({ name, value })),
          },
        };
      },
    },
  } as unknown as Context;
}

describe("auth-digest against a live server", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await close?.();
    close = null;
  });

  for (const algorithm of ["MD5", "MD5-sess", "SHA-256", "SHA-256-sess"]) {
    test(`authenticates with algorithm=${algorithm}`, async () => {
      const server = await startDigestServer({
        username: "Mufasa",
        password: "Circle of Life",
        realm: "http-auth@example.org",
        nonce: "7ypf/xlj9XXwfDPEoM4URrv",
        algorithm,
        qop: "auth",
      });
      close = server.close;

      const url = `${server.url}/dir/index.html?a=b`;
      const result = await plugin.authentication!.onApply(realContext(), {
        values: { username: "Mufasa", password: "Circle of Life" },
        headers: [],
        url,
        method: "GET",
        body: null,
        contextId: "ctx",
      });

      const res = await fetch(url, {
        headers: { Authorization: result.setHeaders![0]!.value },
      });
      expect([res.status, await res.text()]).toEqual([200, "welcome"]);
    });
  }

  test("authenticates a POST body with qop=auth-int", async () => {
    const body = '{"hello":"world"}';
    const server = await startDigestServer({
      username: "user",
      password: "pass",
      realm: "api@example.org",
      nonce: "n0nc3",
      algorithm: "SHA-256",
      qop: "auth,auth-int",
    });
    close = server.close;

    const url = `${server.url}/submit`;
    const result = await plugin.authentication!.onApply(realContext(), {
      values: { username: "user", password: "pass" },
      headers: [],
      url,
      method: "POST",
      body,
      contextId: "ctx",
    });

    expect(result.setHeaders![0]!.value).toContain("qop=auth-int");

    const res = await fetch(url, {
      method: "POST",
      body,
      headers: { Authorization: result.setHeaders![0]!.value },
    });
    expect([res.status, await res.text()]).toEqual([200, "welcome"]);
  });

  test("authenticates against an RFC 2069 server that offers no qop", async () => {
    const server = await startDigestServer({
      username: "user",
      password: "pass",
      realm: "legacy@example.org",
      nonce: "old-nonce",
    });
    close = server.close;

    const url = `${server.url}/legacy`;
    const result = await plugin.authentication!.onApply(realContext(), {
      values: { username: "user", password: "pass" },
      headers: [],
      url,
      method: "GET",
      body: null,
      contextId: "ctx",
    });

    const res = await fetch(url, { headers: { Authorization: result.setHeaders![0]!.value } });
    expect([res.status, await res.text()]).toEqual([200, "welcome"]);
  });

  test("picks the configured realm out of several the server offers", async () => {
    const server = await startDigestServer({
      username: "user",
      password: "pass",
      realm: "second@example.org",
      nonce: "n0nc3",
      qop: "auth",
      decoyRealm: "first@example.org",
    });
    close = server.close;

    const url = `${server.url}/multi`;
    const result = await plugin.authentication!.onApply(realContext(), {
      values: { username: "user", password: "pass", realm: "second@example.org" },
      headers: [],
      url,
      method: "GET",
      body: null,
      contextId: "ctx",
    });

    const res = await fetch(url, { headers: { Authorization: result.setHeaders![0]!.value } });
    expect(res.status).toEqual(200);
  });
});
