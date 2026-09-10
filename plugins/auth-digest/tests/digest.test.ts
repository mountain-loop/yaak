import { describe, expect, test } from "vite-plus/test";
import {
  buildDigestAuthorization,
  parseChallenges,
  requestTarget,
  selectDigestChallenge,
  toDigestChallenge,
} from "../src/digest";

function paramOf(header: string, name: string): string | undefined {
  return parseChallenges([header])[0]?.params[name];
}

describe("parseChallenges", () => {
  test("parses quoted and unquoted parameters", () => {
    expect(parseChallenges(['Digest realm="test", algorithm=MD5, stale=TRUE'])).toEqual([
      { scheme: "Digest", params: { realm: "test", algorithm: "MD5", stale: "TRUE" } },
    ]);
  });

  test("keeps commas and escapes inside quoted values", () => {
    expect(paramOf('Digest qop="auth,auth-int", realm="a \\"quoted\\" realm"', "qop")).toEqual(
      "auth,auth-int",
    );
    expect(paramOf('Digest qop="auth,auth-int", realm="a \\"quoted\\" realm"', "realm")).toEqual(
      'a "quoted" realm',
    );
  });

  test("tolerates whitespace around the equals sign", () => {
    expect(paramOf('Digest realm = "test"', "realm")).toEqual("test");
  });

  test("splits multiple challenges in a single header", () => {
    expect(parseChallenges(['Basic realm="a", Digest realm="b", nonce="n"'])).toEqual([
      { scheme: "Basic", params: { realm: "a" } },
      { scheme: "Digest", params: { realm: "b", nonce: "n" } },
    ]);
  });

  test("collects challenges across repeated headers", () => {
    expect(parseChallenges(['Digest realm="a"', "Negotiate"]).map((c) => c.scheme)).toEqual([
      "Digest",
      "Negotiate",
    ]);
  });

  test("captures token68 credentials rather than reading them as parameters", () => {
    expect(parseChallenges(["NTLM TlRMTVNTUAACAAAAAA=="])).toEqual([
      { scheme: "NTLM", params: {}, token68: "TlRMTVNTUAACAAAAAA==" },
    ]);
  });

  test("lower-cases parameter names", () => {
    expect(paramOf('Digest Realm="test", NONCE="n"', "realm")).toEqual("test");
    expect(paramOf('Digest Realm="test", NONCE="n"', "nonce")).toEqual("n");
  });
});

describe("toDigestChallenge", () => {
  test("splits qop and reads the boolean flags", () => {
    const challenge = toDigestChallenge(
      parseChallenges(['Digest realm="r", nonce="n", qop=" auth , AUTH-INT ", stale=true'])[0]!
        .params,
    );
    expect(challenge.qop).toEqual(["auth", "auth-int"]);
    expect(challenge.stale).toBe(true);
    expect(challenge.userhash).toBe(false);
  });

  test("treats a missing qop as absent rather than empty", () => {
    expect(toDigestChallenge(parseChallenges(['Digest realm="r", nonce="n"'])[0]!.params).qop).toBe(
      undefined,
    );
  });

  test("reads userhash", () => {
    expect(
      toDigestChallenge(parseChallenges(['Digest realm="r", nonce="n", userhash=TRUE'])[0]!.params)
        .userhash,
    ).toBe(true);
  });
});

describe("selectDigestChallenge", () => {
  const md5 = 'Digest realm="a", nonce="n1", algorithm=MD5';
  const sha = 'Digest realm="b", nonce="n2", algorithm=SHA-256';

  test("takes the first Digest challenge the server prefers", () => {
    expect(selectDigestChallenge(parseChallenges([sha, md5])).nonce).toEqual("n2");
  });

  test("skips challenges whose algorithm is not supported", () => {
    const unsupported = 'Digest realm="c", nonce="n0", algorithm=SHA-512-256';
    expect(selectDigestChallenge(parseChallenges([unsupported, md5])).nonce).toEqual("n1");
  });

  test("matches the case-insensitive scheme name", () => {
    expect(selectDigestChallenge(parseChallenges(['digest realm="a", nonce="n1"'])).nonce).toEqual(
      "n1",
    );
  });

  test("selects by realm when one is given", () => {
    expect(selectDigestChallenge(parseChallenges([sha, md5]), "a").nonce).toEqual("n1");
  });

  test("errors when the requested realm is not offered", () => {
    expect(() => selectDigestChallenge(parseChallenges([sha, md5]), "nope")).toThrow(
      'Server did not offer a Digest realm named "nope". It offered: "b", "a"',
    );
  });

  test("errors when the server offers no Digest challenge", () => {
    expect(() => selectDigestChallenge(parseChallenges(['Basic realm="a"', "Negotiate"]))).toThrow(
      "Server did not offer Digest authentication. It offered: Basic, Negotiate",
    );
  });

  test("errors when the response carries no challenge at all", () => {
    expect(() => selectDigestChallenge(parseChallenges([]))).toThrow(
      "no WWW-Authenticate header in the response",
    );
  });

  test("errors when no offered algorithm is supported", () => {
    expect(() =>
      selectDigestChallenge(
        parseChallenges(['Digest realm="c", nonce="n", algorithm=SHA-512-256']),
      ),
    ).toThrow("Unsupported Digest algorithm: SHA-512-256");
  });

  test("errors when the challenge has no nonce", () => {
    expect(() => selectDigestChallenge(parseChallenges(['Digest realm="c"']))).toThrow(
      'Digest challenge is missing the required "nonce" parameter',
    );
  });
});

// https://datatracker.ietf.org/doc/html/rfc7616#section-3.9.1
describe("RFC 7616 §3.9.1 worked example", () => {
  const headers = [
    'Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, ' +
      'nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", ' +
      'opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"',
    'Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=MD5, ' +
      'nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", ' +
      'opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"',
  ];
  const common = {
    username: "Mufasa",
    password: "Circle of Life",
    method: "GET",
    uri: "/dir/index.html",
    body: null,
    cnonce: "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
    nc: 1,
  };

  test("SHA-256", () => {
    expect(
      buildDigestAuthorization({
        ...common,
        challenge: selectDigestChallenge(parseChallenges(headers)),
      }),
    ).toEqual(
      'Digest username="Mufasa", realm="http-auth@example.org", uri="/dir/index.html", ' +
        'algorithm=SHA-256, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", ' +
        'nc=00000001, cnonce="f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ", qop=auth, ' +
        'response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1", ' +
        'opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"',
    );
  });

  test("MD5", () => {
    expect(
      buildDigestAuthorization({
        ...common,
        challenge: selectDigestChallenge(parseChallenges([headers[1]!])),
      }),
    ).toEqual(
      'Digest username="Mufasa", realm="http-auth@example.org", uri="/dir/index.html", ' +
        'algorithm=MD5, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", ' +
        'nc=00000001, cnonce="f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ", qop=auth, ' +
        'response="8ca523f5e9506fed4657c9700eebdbec", ' +
        'opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"',
    );
  });
});

// https://datatracker.ietf.org/doc/html/rfc2617#section-3.5
describe("RFC 2617 §3.5 worked example", () => {
  test("MD5 with qop=auth", () => {
    const challenge = selectDigestChallenge(
      parseChallenges([
        'Digest realm="testrealm@host.com", qop="auth,auth-int", ' +
          'nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
      ]),
    );
    expect(
      buildDigestAuthorization({
        username: "Mufasa",
        password: "Circle Of Life",
        method: "GET",
        uri: "/dir/index.html",
        body: null,
        challenge,
        cnonce: "0a4f113b",
        nc: 1,
      }),
    ).toContain('response="6629fae49393a05397450978507c4ef1"');
  });
});

describe("buildDigestAuthorization", () => {
  const base = {
    username: "user",
    password: "pass",
    method: "POST",
    uri: "/api",
    body: null as string | null,
    cnonce: "abc123",
    nc: 1,
  };

  test("omits the client's contribution when the server offers no qop", () => {
    const header = buildDigestAuthorization({
      ...base,
      challenge: selectDigestChallenge(parseChallenges(['Digest realm="r", nonce="n"'])),
    });
    expect(header).not.toContain("qop=");
    expect(header).not.toContain("cnonce=");
    expect(header).not.toContain("nc=");
    // MD5(HA1:nonce:HA2), per RFC 2069.
    expect(header).toContain('response="24644771b8983deed818b83aeb3ac381"');
  });

  test("omits algorithm when the challenge did not name one", () => {
    expect(
      buildDigestAuthorization({
        ...base,
        challenge: selectDigestChallenge(parseChallenges(['Digest realm="r", nonce="n"'])),
      }),
    ).not.toContain("algorithm=");
  });

  test("uses auth-int over the body when the server offers it", () => {
    const header = buildDigestAuthorization({
      ...base,
      body: '{"a":1}',
      challenge: selectDigestChallenge(
        parseChallenges(['Digest realm="r", nonce="n", qop="auth,auth-int"']),
      ),
    });
    expect(header).toContain("qop=auth-int");
  });

  test("falls back to auth when no body was handed over", () => {
    expect(
      buildDigestAuthorization({
        ...base,
        challenge: selectDigestChallenge(
          parseChallenges(['Digest realm="r", nonce="n", qop="auth,auth-int"']),
        ),
      }),
    ).toContain("qop=auth");
  });

  test("uses auth-int over an empty body when it is the only qop offered", () => {
    expect(
      buildDigestAuthorization({
        ...base,
        challenge: selectDigestChallenge(
          parseChallenges(['Digest realm="r", nonce="n", qop="auth-int"']),
        ),
      }),
    ).toContain("qop=auth-int");
  });

  test("rejects a qop it cannot compute", () => {
    expect(() =>
      buildDigestAuthorization({
        ...base,
        challenge: selectDigestChallenge(
          parseChallenges(['Digest realm="r", nonce="n", qop="auth-conf"']),
        ),
      }),
    ).toThrow("Unsupported Digest qop: auth-conf");
  });

  test("mixes the cnonce into HA1 for -sess algorithms", () => {
    const sess = buildDigestAuthorization({
      ...base,
      challenge: selectDigestChallenge(
        parseChallenges(['Digest realm="r", nonce="n", qop=auth, algorithm=MD5-sess']),
      ),
    });
    const plain = buildDigestAuthorization({
      ...base,
      challenge: selectDigestChallenge(
        parseChallenges(['Digest realm="r", nonce="n", qop=auth, algorithm=MD5']),
      ),
    });
    expect(sess).toContain("algorithm=MD5-sess");
    expect(sess).not.toEqual(plain);
  });

  test("declines userhash when the server advertises it", () => {
    expect(
      buildDigestAuthorization({
        ...base,
        challenge: selectDigestChallenge(
          parseChallenges(['Digest realm="r", nonce="n", qop=auth, userhash=true']),
        ),
      }),
    ).toContain("userhash=false");
  });

  test("escapes quotes in the credentials it echoes back", () => {
    expect(
      buildDigestAuthorization({
        ...base,
        username: 'a"b',
        challenge: selectDigestChallenge(parseChallenges(['Digest realm="r", nonce="n"'])),
      }),
    ).toContain('username="a\\"b"');
  });

  test("sends a non-ASCII username as an RFC 5987 extended value", () => {
    expect(
      buildDigestAuthorization({
        ...base,
        username: "Jäsøn Doe",
        challenge: selectDigestChallenge(parseChallenges(['Digest realm="r", nonce="n"'])),
      }),
    ).toContain("username*=UTF-8''J%C3%A4s%C3%B8n%20Doe");
  });
});

describe("requestTarget", () => {
  test("keeps the path and query", () => {
    expect(requestTarget("https://example.org/dir/index.html?a=b&c=d")).toEqual(
      "/dir/index.html?a=b&c=d",
    );
  });

  test("uses a bare slash when there is no path", () => {
    expect(requestTarget("https://example.org")).toEqual("/");
  });

  test("handles a URL with no scheme", () => {
    expect(requestTarget("localhost:8080/thing")).toEqual("/thing");
  });
});
