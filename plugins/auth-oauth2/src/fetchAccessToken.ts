import type { Context, HttpRequest, HttpUrlParameter } from "@yaakapp/api";
import type { AccessTokenRawResponse } from "./store";

export async function fetchAccessToken(
  ctx: Context,
  args: {
    clientId: string;
    grantType: string;
    accessTokenUrl: string;
    scope: string | null;
    audience: string | null;
    params: HttpUrlParameter[];
  } & ({ clientAssertion: string } | { clientSecret: string; credentialsInBody: boolean }),
): Promise<AccessTokenRawResponse> {
  const { clientId, grantType, accessTokenUrl, scope, audience, params } = args;
  console.log("[oauth2] Getting access token", accessTokenUrl);
  const httpRequest: Partial<HttpRequest> = {
    method: "POST",
    url: accessTokenUrl,
    bodyType: "application/x-www-form-urlencoded",
    body: {
      form: [{ name: "grant_type", value: grantType }, ...params],
    },
    headers: [
      { name: "User-Agent", value: "yaak" },
      {
        name: "Accept",
        value: "application/x-www-form-urlencoded, application/json",
      },
      { name: "Content-Type", value: "application/x-www-form-urlencoded" },
    ],
  };

  // RFC 6749 §4.1.3 doesn't define scope for the authorization code token
  // request, so strict servers (OpenIddict) reject it outright. Scope belongs on
  // the authorize request, which already sends it. Every other grant does define
  // it: §4.3.2 password, §4.4.2 client credentials, §6 refresh.
  if (scope && grantType !== "authorization_code") {
    httpRequest.body?.form.push({ name: "scope", value: scope });
  }
  if (audience) httpRequest.body?.form.push({ name: "audience", value: audience });

  if ("clientAssertion" in args) {
    httpRequest.body?.form.push({ name: "client_id", value: clientId });
    httpRequest.body?.form.push({
      name: "client_assertion_type",
      value: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    });
    httpRequest.body?.form.push({
      name: "client_assertion",
      value: args.clientAssertion,
    });
  } else if (args.credentialsInBody) {
    httpRequest.body?.form.push({ name: "client_id", value: clientId });
    httpRequest.body?.form.push({
      name: "client_secret",
      value: args.clientSecret,
    });
  } else {
    const value = `Basic ${Buffer.from(`${clientId}:${args.clientSecret}`).toString("base64")}`;
    httpRequest.headers?.push({ name: "Authorization", value });
  }

  httpRequest.authenticationType = "none"; // Don't inherit workspace auth
  const { httpResponse: resp, body: responseBody } = await ctx.httpRequest.send({ httpRequest });

  console.log("[oauth2] Got access token response", resp.status);

  if (resp.error) {
    throw new Error(`Failed to fetch access token: ${resp.error}`);
  }

  // A token request is sent ad-hoc, with no id, so nothing saves the response
  // and this body is the only copy of it. An empty one parses to {} below,
  // which is what reading a missing file used to give.
  const body = await responseBody.text();

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Failed to fetch access token with status=${resp.status} and body=${body}`);
  }

  // oxlint-disable-next-line no-explicit-any
  let response: any;
  try {
    response = JSON.parse(body);
  } catch {
    response = Object.fromEntries(new URLSearchParams(body));
  }

  if (response.error) {
    throw new Error(`Failed to fetch access token with ${response.error}`);
  }

  return response;
}
