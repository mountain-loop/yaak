import { createHash } from 'node:crypto';
import type { Context } from '@yaakapp/api';

export async function storeToken(
  ctx: Context,
  args: TokenStoreArgs,
  response: AccessTokenRawResponse,
  tokenName: 'access_token' | 'id_token' = 'access_token',
) {
  if (!response[tokenName]) {
    throw new Error(`${tokenName} not found in response ${Object.keys(response).join(', ')}`);
  }

  const expiresAt = response.expires_in ? Date.now() + response.expires_in * 1000 : null;
  const token: AccessToken = {
    response,
    expiresAt,
  };
  await ctx.store.set<AccessToken>(tokenStoreKey(args), token);
  return token;
}

export async function getToken(ctx: Context, args: TokenStoreArgs) {
  return ctx.store.get<AccessToken>(tokenStoreKey(args));
}

export async function deleteToken(ctx: Context, args: TokenStoreArgs) {
  return ctx.store.delete(tokenStoreKey(args));
}

export async function resetDataDirKey(ctx: Context, contextId: string) {
  const key = new Date().toISOString();
  return ctx.store.set<string>(dataDirStoreKey(contextId), key);
}

export async function getDataDirKey(ctx: Context, contextId: string) {
  const key = (await ctx.store.get<string>(dataDirStoreKey(contextId))) ?? 'default';
  return `${contextId}::${key}`;
}

export interface TokenStoreArgs {
  contextId: string;
  clientId: string;
  accessTokenUrl: string | null;
  authorizationUrl: string | null;
}

/**
 * Generate a store key to use based on some arguments. The arguments will be normalized a bit to
 * account for slight variations (like domains with and without a protocol scheme).
 */
function tokenStoreKey(args: TokenStoreArgs) {
  const hash = createHash('md5');
  if (args.contextId) hash.update(args.contextId.trim());
  if (args.clientId) hash.update(args.clientId.trim());
  if (args.accessTokenUrl) hash.update(args.accessTokenUrl.trim().replace(/^https?:\/\//, ''));
  if (args.authorizationUrl) hash.update(args.authorizationUrl.trim().replace(/^https?:\/\//, ''));
  const key = hash.digest('hex');
  return ['token', key].join('::');
}

function dataDirStoreKey(contextId: string) {
  return ['data_dir', contextId].join('::');
}

export interface AccessToken {
  response: AccessTokenRawResponse;
  expiresAt: number | null;
}

export interface AccessTokenRawResponse {
  access_token: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
  scope?: string;
}
