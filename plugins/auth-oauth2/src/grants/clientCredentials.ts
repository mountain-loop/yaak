import { createPrivateKey, JsonWebKeyInput, randomUUID } from 'node:crypto';
import type { Context } from '@yaakapp/api';
import { fetchAccessToken } from '../fetchAccessToken';
import type { TokenStoreArgs } from '../store';
import { getToken, storeToken } from '../store';
import { isTokenExpired } from '../util';
import jwt, { Algorithm, JwtHeader } from 'jsonwebtoken';

export const jwtAlgorithms = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'none',
] as const;

export const defaultJwtAlgorithm = jwtAlgorithms[0];

/**
 * Build a signed JWT for the client_assertion parameter (RFC 7523).
 *
 * The `secret` value is auto-detected as one of:
 *   - **JWK** – a JSON string containing a private-key object (has a `kty` field).
 *   - **PEM** – a string whose trimmed form starts with `-----`.
 *   - **HMAC secret** – anything else, used as-is for HS* algorithms.
 */
function buildClientAssertionJwt(params: {
  clientId: string;
  accessTokenUrl: string;
  secret: string;
  algorithm: Algorithm;
}): string {
  const { clientId, accessTokenUrl, secret, algorithm } = params;

  const isHmac = algorithm.startsWith('HS') || algorithm === 'none';

  // Resolve the signing key depending on format
  let signingKey: jwt.Secret;
  let kid: string | undefined;

  const trimmed = secret.trim();

  if (isHmac) {
    // HMAC algorithms use the raw secret (string or Buffer)
    signingKey = secret;
  } else if (trimmed.startsWith('{')) {
    // Looks like JSON - treat as JWK. There is surely a better way to detect JWK vs a raw secret, but this should work in most cases.
    let jwk: any;
    try {
      jwk = JSON.parse(trimmed);
    } catch {
      throw new Error('Client Assertion secret looks like JSON but is not valid');
    }

    kid = jwk?.kid;
    signingKey = createPrivateKey({ key: jwk, format: 'jwk' });
  } else if (trimmed.startsWith('-----')) {
    // PEM-encoded key
    signingKey = createPrivateKey({ key: trimmed, format: 'pem' });
  } else {
    throw new Error(
      'Client Assertion secret must be a JWK JSON object, a PEM-encoded key ' +
        '(starting with -----), or a raw secret for HMAC algorithms.',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: accessTokenUrl,
    iat: now,
    exp: now + 300, // 5 minutes
    jti: randomUUID(),
  };

  // Build the JWT header; include "kid" when available
  const header: jwt.JwtHeader = { alg: algorithm, typ: 'JWT' };
  if (kid) {
    header.kid = kid;
  }

  return jwt.sign(JSON.stringify(payload), signingKey, {
    algorithm: algorithm as jwt.Algorithm,
    header,
  });
}

export async function getClientCredentials(
  ctx: Context,
  contextId: string,
  {
    accessTokenUrl,
    clientId,
    clientSecret,
    scope,
    audience,
    credentialsInBody,
    clientAssertionSecret,
    clientAssertionSecretBase64,
    clientCredentialsMethod,
    clientAssertionAlgorithm,
  }: {
    accessTokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope: string | null;
    audience: string | null;
    credentialsInBody: boolean;
    clientAssertionSecret: string;
    clientAssertionSecretBase64: boolean;
    clientCredentialsMethod: string;
    clientAssertionAlgorithm: string;
  },
) {
  const tokenArgs: TokenStoreArgs = {
    contextId,
    clientId,
    accessTokenUrl,
    authorizationUrl: null,
  };
  const token = await getToken(ctx, tokenArgs);
  if (token && !isTokenExpired(token)) {
    return token;
  }

  const fetchParams: Parameters<typeof fetchAccessToken>[1] = {
    grantType: 'client_credentials',
    accessTokenUrl,
    audience,
    clientId,
    scope,
    credentialsInBody,
    params: [],
  };

  if (clientCredentialsMethod === 'client_assertion') {
    fetchParams.clientAssertion = buildClientAssertionJwt({
      clientId,
      algorithm: clientAssertionAlgorithm as Algorithm,
      accessTokenUrl,
      secret: clientAssertionSecretBase64
        ? Buffer.from(clientAssertionSecret, 'base64').toString('utf-8')
        : clientAssertionSecret,
    });
  }

  if (clientCredentialsMethod === 'client_credentials') {
    fetchParams.clientSecret = clientSecret;
  }

  const response = await fetchAccessToken(ctx, fetchParams);

  return storeToken(ctx, tokenArgs, response);
}
