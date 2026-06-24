import type { Context } from "@yaakapp/api";
import { fetchAccessToken } from "../fetchAccessToken";
import { getOrRefreshAccessToken } from "../getOrRefreshAccessToken";
import type { AccessToken, TokenStoreArgs } from "../store";
import { storeToken } from "../store";

export async function getPassword(
  ctx: Context,
  contextId: string,
  {
    accessTokenUrl,
    clientId,
    clientSecret,
    username,
    password,
    credentialsInBody,
    audience,
    scope,
  }: {
    accessTokenUrl: string;
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    scope: string | null;
    audience: string | null;
    credentialsInBody: boolean;
  },
): Promise<AccessToken> {
  const tokenArgs: TokenStoreArgs = {
    contextId,
    clientId,
    accessTokenUrl,
    authorizationUrl: null,
  };
  const token = await getOrRefreshAccessToken(ctx, tokenArgs, {
    accessTokenUrl,
    scope,
    clientId,
    clientSecret,
    credentialsInBody,
  });
  if (token != null) {
    return token;
  }

  const response = await fetchAccessToken(ctx, {
    accessTokenUrl,
    clientId,
    clientSecret,
    scope,
    audience,
    grantType: "password",
    credentialsInBody,
    params: [
      { name: "username", value: username },
      { name: "password", value: password },
    ],
  });

  return storeToken(ctx, tokenArgs, response);
}
