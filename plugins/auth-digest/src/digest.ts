import { createHash } from "node:crypto";

/** A single challenge from a `WWW-Authenticate` header. */
export interface AuthChallenge {
  scheme: string;
  params: Record<string, string>;
  /** The `token68` form (`NTLM TlRMTVNT…`), which carries no parameters. */
  token68?: string;
}

export interface DigestChallenge {
  realm: string;
  nonce: string;
  opaque?: string;
  qop?: string[];
  /** Echoed back verbatim, so it must keep the server's own spelling. */
  algorithm?: string;
  stale: boolean;
  userhash: boolean;
}

export interface DigestAuthorizationOptions {
  username: string;
  password: string;
  method: string;
  uri: string;
  body: string | null;
  challenge: DigestChallenge;
  cnonce: string;
  nc: number;
}

const TOKEN = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+";
const PARAM_RE = new RegExp(`^(${TOKEN})\\s*=\\s*([\\s\\S]*)$`);
const SCHEME_RE = new RegExp(`^(${TOKEN})(?:\\s+([\\s\\S]*))?$`);
const TOKEN68_RE = /^[A-Za-z0-9\-._~+/]+=*$/;

const SUPPORTED_ALGORITHMS = ["MD5", "MD5-sess", "SHA-256", "SHA-256-sess"];

/**
 * Split a header value on commas that aren't inside a quoted string. Both
 * challenges and their parameters are comma-separated, so this yields a flat
 * list that {@link parseChallenges} re-groups.
 */
function splitOnCommas(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (quoted && char === "\\" && i + 1 < value.length) {
      current += char + value[++i]!;
    } else if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (char === "," && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\([\s\S])/g, "$1");
  }
  return trimmed;
}

export function parseChallenges(headerValues: string[]): AuthChallenge[] {
  const challenges: AuthChallenge[] = [];

  for (const headerValue of headerValues) {
    let current: AuthChallenge | null = null;

    for (const part of splitOnCommas(headerValue)) {
      const param = PARAM_RE.exec(part);
      if (param != null && current != null) {
        current.params[param[1]!.toLowerCase()] = unquote(param[2]!);
        continue;
      }

      const scheme = SCHEME_RE.exec(part);
      if (scheme == null) continue;

      current = { scheme: scheme[1]!, params: {} };
      challenges.push(current);

      const rest = scheme[2]?.trim();
      if (rest == null || rest === "") continue;

      if (TOKEN68_RE.test(rest)) {
        current.token68 = rest;
        continue;
      }

      const firstParam = PARAM_RE.exec(rest);
      if (firstParam != null) {
        current.params[firstParam[1]!.toLowerCase()] = unquote(firstParam[2]!);
      }
    }
  }

  return challenges;
}

export function toDigestChallenge(params: Record<string, string>): DigestChallenge {
  const qop = params.qop
    ?.split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  return {
    realm: params.realm ?? "",
    nonce: params.nonce ?? "",
    opaque: params.opaque,
    qop: qop == null || qop.length === 0 ? undefined : qop,
    algorithm: params.algorithm,
    stale: params.stale?.toLowerCase() === "true",
    userhash: params.userhash?.toLowerCase() === "true",
  };
}

/**
 * `MD5`, `MD5-sess`, `SHA-256` and `SHA-256-sess`, tolerating the `SHA256`
 * spelling some servers use. Returns null for anything else.
 */
function resolveAlgorithm(algorithm: string | undefined): { hash: string; sess: boolean } | null {
  const value = (algorithm ?? "MD5").trim().toLowerCase();
  const sess = value.endsWith("-sess");
  const base = (sess ? value.slice(0, -"-sess".length) : value).replace(/-/g, "");
  if (base === "md5") return { hash: "md5", sess };
  if (base === "sha256") return { hash: "sha256", sess };
  return null;
}

/**
 * Pick the challenge to answer. Servers list challenges strongest-first
 * (RFC 7616 §3.7), so the first one we can compute is the one to use.
 */
export function selectDigestChallenge(
  challenges: AuthChallenge[],
  realm?: string,
): DigestChallenge {
  const digestChallenges = challenges.filter((c) => c.scheme.toLowerCase() === "digest");

  if (digestChallenges.length === 0) {
    const offered = challenges.map((c) => c.scheme).join(", ");
    throw new Error(
      offered === ""
        ? "Server did not offer Digest authentication (no WWW-Authenticate header in the response)"
        : `Server did not offer Digest authentication. It offered: ${offered}`,
    );
  }

  const inRealm =
    realm == null || realm === ""
      ? digestChallenges
      : digestChallenges.filter((c) => c.params.realm === realm);

  if (inRealm.length === 0) {
    const offered = digestChallenges.map((c) => JSON.stringify(c.params.realm ?? "")).join(", ");
    throw new Error(`Server did not offer a Digest realm named "${realm}". It offered: ${offered}`);
  }

  const supported = inRealm.find((c) => resolveAlgorithm(c.params.algorithm) != null);
  if (supported == null) {
    const offered = inRealm.map((c) => c.params.algorithm ?? "MD5").join(", ");
    throw new Error(
      `Unsupported Digest algorithm: ${offered}. Supported algorithms are ${SUPPORTED_ALGORITHMS.join(", ")}`,
    );
  }

  const challenge = toDigestChallenge(supported.params);
  if (challenge.nonce === "") {
    throw new Error('Digest challenge is missing the required "nonce" parameter');
  }

  return challenge;
}

/**
 * Prefer `auth-int` only when the body is in hand, since its digest covers the
 * exact bytes sent. A body offered as `null` is a body Yaak didn't hand over
 * (too large, or streamed from a file), not necessarily an empty one.
 */
function selectQop(qop: string[], body: string | null): "auth" | "auth-int" {
  if (qop.includes("auth-int") && (body != null || !qop.includes("auth"))) return "auth-int";
  if (qop.includes("auth")) return "auth";
  throw new Error(
    `Unsupported Digest qop: ${qop.join(", ")}. Supported values are auth and auth-int`,
  );
}

function quote(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

/** RFC 5987 `ext-value`, used for usernames that a quoted-string can't carry. */
function encodeExtended(value: string): string {
  const encoded = encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `UTF-8''${encoded}`;
}

export function buildDigestAuthorization(options: DigestAuthorizationOptions): string {
  const { username, password, method, uri, body, challenge, cnonce, nc } = options;

  const algorithm = resolveAlgorithm(challenge.algorithm);
  if (algorithm == null) {
    throw new Error(
      `Unsupported Digest algorithm: ${challenge.algorithm}. Supported algorithms are ${SUPPORTED_ALGORITHMS.join(", ")}`,
    );
  }

  const hash = (value: string) => createHash(algorithm.hash).update(value, "utf8").digest("hex");
  const qop = challenge.qop == null ? null : selectQop(challenge.qop, body);
  const ncHex = nc.toString(16).padStart(8, "0");

  const secret = hash(`${username}:${challenge.realm}:${password}`);
  const ha1 = algorithm.sess ? hash(`${secret}:${challenge.nonce}:${cnonce}`) : secret;
  const ha2 =
    qop === "auth-int" ? hash(`${method}:${uri}:${hash(body ?? "")}`) : hash(`${method}:${uri}`);

  // Without qop the server speaks RFC 2069, where the client contributes nothing
  // to the digest and so must not send cnonce, nc or qop back.
  const response =
    qop == null
      ? hash(`${ha1}:${challenge.nonce}:${ha2}`)
      : hash(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`);

  const params: string[] = [];
  params.push(
    /^[\x20-\x7E]*$/.test(username)
      ? `username=${quote(username)}`
      : `username*=${encodeExtended(username)}`,
  );
  params.push(`realm=${quote(challenge.realm)}`);
  params.push(`uri=${quote(uri)}`);
  if (challenge.algorithm != null) params.push(`algorithm=${challenge.algorithm}`);
  params.push(`nonce=${quote(challenge.nonce)}`);
  if (qop != null) {
    params.push(`nc=${ncHex}`);
    params.push(`cnonce=${quote(cnonce)}`);
    params.push(`qop=${qop}`);
  }
  params.push(`response=${quote(response)}`);
  if (challenge.opaque != null) params.push(`opaque=${quote(challenge.opaque)}`);
  if (challenge.userhash) params.push("userhash=false");

  return `Digest ${params.join(", ")}`;
}

/** The origin-form request-target the digest is computed over. */
export function requestTarget(url: string): string {
  const absolute = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url) ? url : `http://${url}`;
  const parsed = new URL(absolute);
  return `${parsed.pathname}${parsed.search}`;
}
