import jwt from "jsonwebtoken";
import type { AccessToken } from "./store";

export function isTokenExpired(
  token: AccessToken,
  tokenName: "access_token" | "id_token" = "access_token",
) {
  // Fall back to the JWT's own exp claim for tokens stored without an expiry
  // (eg. from a token response that had no expires_in). Decode the same token
  // that gets sent as the credential.
  const expiresAt = token.expiresAt ?? jwtExpiresAt(token.response[tokenName]);
  return expiresAt != null && Date.now() > expiresAt;
}

/**
 * Get the expiry timestamp (ms) from a JWT's `exp` claim, or null if the token
 * is not a JWT or has no `exp`.
 */
export function jwtExpiresAt(token: string | undefined): number | null {
  if (!token) return null;

  try {
    const payload = jwt.decode(token);
    if (payload != null && typeof payload === "object" && typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch {
    // Opaque (non-JWT) token
  }

  return null;
}

export function extractCode(urlStr: string, redirectUri: string | null): string | null {
  const url = new URL(urlStr);

  if (!urlMatchesRedirect(url, redirectUri)) {
    console.log("[oauth2] URL does not match redirect origin/path; skipping.");
    return null;
  }

  // Prefer query param; fall back to fragment if query lacks it

  const query = url.searchParams;
  const queryError = query.get("error");
  const queryDesc = query.get("error_description");
  const queryUri = query.get("error_uri");

  let hashParams: URLSearchParams | null = null;
  if (url.hash && url.hash.length > 1) {
    hashParams = new URLSearchParams(url.hash.slice(1));
  }
  const hashError = hashParams?.get("error");
  const hashDesc = hashParams?.get("error_description");
  const hashUri = hashParams?.get("error_uri");

  const error = queryError || hashError;
  if (error) {
    const desc = queryDesc || hashDesc;
    const uri = queryUri || hashUri;
    let message = `Failed to authorize: ${error}`;
    if (desc) message += ` (${desc})`;
    if (uri) message += ` [${uri}]`;
    throw new Error(message);
  }

  const queryCode = query.get("code");
  if (queryCode) return queryCode;

  const hashCode = hashParams?.get("code");
  if (hashCode) return hashCode;

  console.log("[oauth2] Code not found");
  return null;
}

export function urlMatchesRedirect(url: URL, redirectUrl: string | null): boolean {
  if (!redirectUrl) return true;

  let redirect: URL;
  try {
    redirect = new URL(redirectUrl);
  } catch {
    console.log("[oauth2] Invalid redirect URI; skipping.");
    return false;
  }

  const sameProtocol = url.protocol === redirect.protocol;

  const sameHost = url.hostname.toLowerCase() === redirect.hostname.toLowerCase();

  const normalizePort = (u: URL) =>
    (u.protocol === "https:" && (!u.port || u.port === "443")) ||
    (u.protocol === "http:" && (!u.port || u.port === "80"))
      ? ""
      : u.port;

  const samePort = normalizePort(url) === normalizePort(redirect);

  const normPath = (p: string) => {
    const withLeading = p.startsWith("/") ? p : `/${p}`;
    // strip trailing slashes, keep root as "/"
    return withLeading.replace(/\/+$/g, "") || "/";
  };

  // Require redirect path to be a prefix of the navigated URL path
  const urlPath = normPath(url.pathname);
  const redirectPath = normPath(redirect.pathname);
  const pathMatches = urlPath === redirectPath || urlPath.startsWith(`${redirectPath}/`);

  return sameProtocol && sameHost && samePort && pathMatches;
}
