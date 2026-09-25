import type { HttpRequest } from "@yaakapp/api";
import { object, template, text, type Obj } from "./common";

type Authentication = Pick<HttpRequest, "authentication" | "authenticationType">;
export function auth(value: unknown, inheritWhenAbsent = false): Authentication {
  // Bruno omits auth for 'none'. A folder without request defaults inherits from its parent.
  if (value === "inherit" || (inheritWhenAbsent && value == null))
    return { authenticationType: null, authentication: {} };
  const a = object(value);
  const type = text(a.type);
  const fields = (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, template(a[name])]));
  switch (type) {
    case "basic":
    case "digest":
      return { authenticationType: type, authentication: fields(["username", "password"]) };
    case "bearer":
      return { authenticationType: type, authentication: fields(["token"]) };
    case "ntlm":
      return {
        authenticationType: "windows",
        authentication: fields(["username", "password", "domain"]),
      };
    case "awsv4":
      if (a.profileName) break;
      return {
        authenticationType: type,
        authentication: fields([
          "accessKeyId",
          "secretAccessKey",
          "sessionToken",
          "region",
          "service",
        ]),
      };
    case "apikey":
      return {
        authenticationType: type,
        authentication: {
          ...fields(["key", "value"]),
          location: a.placement === "query" ? "query" : "header",
        },
      };
    case "oauth1": {
      const privateKey = object(a.privateKey);
      if (
        (a.placement != null && a.placement !== "header") ||
        a.includeBodyHash === true ||
        privateKey.type === "file"
      )
        break;
      return {
        authenticationType: type,
        authentication: {
          ...fields([
            "consumerKey",
            "consumerSecret",
            "verifier",
            "timestamp",
            "nonce",
            "version",
            "realm",
          ]),
          signatureMethod: text(a.signatureMethod) || "HMAC-SHA1",
          tokenKey: template(a.accessToken),
          tokenSecret: template(a.accessTokenSecret),
          callback: template(a.callbackUrl),
          privateKey: template(typeof a.privateKey === "string" ? a.privateKey : privateKey.value),
        },
      };
    }
    case "oauth2": {
      const flow = text(a.flow);
      const token = object(a.tokenConfig);
      const placement = object(token.placement);
      // Yaak currently places OAuth tokens in a header and uses the access token.
      if (
        placement.query != null ||
        token.source === "id_token" ||
        ![
          "authorization_code",
          "client_credentials",
          "resource_owner_password_credentials",
          "implicit",
        ].includes(flow)
      )
        break;
      const credentials = object(a.credentials);
      const owner = object(a.resourceOwner);
      const pkce = object(a.pkce);
      return {
        authenticationType: type,
        authentication: {
          ...fields(["authorizationUrl", "accessTokenUrl", "scope", "state"]),
          grantType: flow === "resource_owner_password_credentials" ? "password" : flow,
          clientId: template(credentials.clientId),
          clientSecret: template(credentials.clientSecret),
          credentials: credentials.placement === "basic_auth_header" ? "basic" : "body",
          redirectUri: template(a.callbackUrl),
          username: template(owner.username),
          password: template(owner.password),
          usePkce: a.pkce != null && pkce.disabled !== true,
          pkceChallengeMethod: pkce.method === "plain" ? "plain" : "S256",
          headerPrefix: placement.header == null ? "Bearer" : template(placement.header),
        },
      };
    }
  }
  return { authenticationType: "none", authentication: {} };
}

export function manualAuth(value: unknown): Obj | undefined {
  const a = object(value);
  if (!Object.keys(a).length) return;
  if (auth(value).authenticationType === "none") return a;
  // OAuth settings beyond the core flow are retained for manual migration.
  if (a.type === "oauth2" && (a.additionalParameters || a.refreshTokenUrl || a.settings)) return a;
}
