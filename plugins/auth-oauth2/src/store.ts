import { Context } from '@yaakapp/api';

export async function storeToken(
  ctx: Context,
  contextId: string,
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
  await ctx.store.set<AccessToken>(tokenStoreKey(contextId), token);
  return token;
}

export async function getToken(ctx: Context, contextId: string) {
  return ctx.store.get<AccessToken>(tokenStoreKey(contextId));
}

export async function deleteToken(ctx: Context, contextId: string) {
  return ctx.store.delete(tokenStoreKey(contextId));
}

export async function resetDataDirKey(ctx: Context, contextId: string) {
  const key = new Date().toISOString();
  return ctx.store.set<string>(dataDirStoreKey(contextId), key);
}

export async function getDataDirKey(ctx: Context, contextId: string) {
  const key = (await ctx.store.get<string>(dataDirStoreKey(contextId))) ?? 'default';
  return `${contextId}::${key}`;
}

function tokenStoreKey(contextId: string) {
  return ['token', contextId].join('::');
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
