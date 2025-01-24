"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  plugin: () => plugin
});
module.exports = __toCommonJS(src_exports);

// src/grants/authorizationCode.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");

// src/store.ts
async function storeToken(ctx, requestId, response) {
  if (!response.access_token) {
    throw new Error(`Token not found in response`);
  }
  const expiresAt = response.expires_in ? Date.now() + response.expires_in * 1e3 : null;
  const token = {
    response,
    expiresAt
  };
  await ctx.store.set(tokenStoreKey(requestId), token);
  return token;
}
async function getToken(ctx, requestId) {
  return ctx.store.get(tokenStoreKey(requestId));
}
function tokenStoreKey(requestId) {
  return ["token", requestId].join("_");
}

// src/grants/authorizationCode.ts
var PKCE_SHA256 = "S256";
var PKCE_PLAIN = "plain";
var DEFAULT_PKCE_METHOD = PKCE_SHA256;
function getAuthorizationCode(ctx, requestId, {
  authorizationUrl: authorizationUrlRaw,
  accessTokenUrl,
  clientId,
  clientSecret,
  redirectUri,
  scope,
  state,
  pkce
}) {
  return new Promise(async (resolve, reject) => {
    const token = await getToken(ctx, requestId);
    if (token) {
    }
    const authorizationUrl = new URL(`${authorizationUrlRaw ?? ""}`);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    if (redirectUri) authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    if (scope) authorizationUrl.searchParams.set("scope", scope);
    if (state) authorizationUrl.searchParams.set("state", state);
    if (pkce) {
      const verifier = pkce.codeVerifier || createPkceCodeVerifier();
      const challengeMethod = pkce.challengeMethod || DEFAULT_PKCE_METHOD;
      authorizationUrl.searchParams.set("code_challenge", createPkceCodeChallenge(verifier, challengeMethod));
      authorizationUrl.searchParams.set("code_challenge_method", challengeMethod);
    }
    const authorizationUrlStr = authorizationUrl.toString();
    console.log("Opening authorization url", authorizationUrlStr);
    let { close } = await ctx.window.openUrl({
      url: authorizationUrlStr,
      label: "oauth-authorization-url",
      async onNavigate({ url: urlStr }) {
        const url = new URL(urlStr);
        if (url.searchParams.has("error")) {
          return reject(new Error(`Failed to authorize: ${url.searchParams.get("error")}`));
        }
        const code = url.searchParams.get("code");
        if (!code) {
          return;
        }
        close();
        const urlParameters = [
          { name: "client_id", value: clientId },
          { name: "code", value: code }
        ];
        if (clientSecret) urlParameters.push({ name: "client_secret", value: clientSecret });
        if (redirectUri) urlParameters.push({ name: "redirect_uri", value: redirectUri });
        const resp = await ctx.httpRequest.send({
          httpRequest: {
            method: "POST",
            url: accessTokenUrl,
            urlParameters,
            headers: [
              { name: "Accept", value: "application/json" },
              { name: "Content-Type", value: "application/x-www-form-urlencoded" }
            ]
          }
        });
        const body = (0, import_node_fs.readFileSync)(resp.bodyPath ?? "", "utf8");
        if (resp.status < 200 || resp.status >= 300) {
          reject(new Error("Failed to fetch access token with status=" + resp.status));
        }
        const response = JSON.parse(body);
        storeToken(ctx, requestId, response).then((token2) => resolve(token2.response.access_token), reject);
      }
    });
  });
}
function createPkceCodeVerifier() {
  return encodeForPkce((0, import_node_crypto.randomBytes)(32));
}
function createPkceCodeChallenge(verifier, method) {
  if (method === "plain") {
    return verifier;
  }
  const hash = encodeForPkce((0, import_node_crypto.createHash)("sha256").update(verifier).digest());
  return hash.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodeForPkce(bytes) {
  return bytes.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// src/grants/implicit.ts
function getImplicit(ctx, requestId, {
  authorizationUrl: authorizationUrlRaw,
  responseType,
  clientId,
  redirectUri,
  scope,
  state
}) {
  return new Promise(async (resolve, reject) => {
    const token = await getToken(ctx, requestId);
    if (token) {
    }
    const authorizationUrl = new URL(`${authorizationUrlRaw ?? ""}`);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    if (redirectUri) authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    if (scope) authorizationUrl.searchParams.set("scope", scope);
    if (state) authorizationUrl.searchParams.set("state", state);
    if (responseType.includes("id_token")) {
      authorizationUrl.searchParams.set("nonce", String(Math.floor(Math.random() * 9999999999999) + 1));
    }
    const authorizationUrlStr = authorizationUrl.toString();
    console.log("Opening authorization url", authorizationUrlStr);
    let { close } = await ctx.window.openUrl({
      url: authorizationUrlStr,
      label: "oauth-authorization-url",
      async onNavigate({ url: urlStr }) {
        const url = new URL(urlStr);
        if (url.searchParams.has("error")) {
          return reject(Error(`Failed to authorize: ${url.searchParams.get("error")}`));
        }
        close();
        const hash = url.hash.slice(1);
        const params = new URLSearchParams(hash);
        const idToken = params.get("id_token");
        if (idToken) {
          params.set("access_token", idToken);
          params.delete("id_token");
        }
        const response = Object.fromEntries(params);
        storeToken(ctx, requestId, response).then((token2) => resolve(token2.response.access_token), reject);
      }
    });
  });
}

// src/index.ts
var grantTypes = [
  { name: "Authorization Code", value: "authorization_code" },
  { name: "Implicit", value: "implicit" },
  { name: "Resource Owner Password Credential", value: "resource_owner" },
  { name: "Client Credentials", value: "client_credential" }
];
var defaultGrantType = grantTypes[0].value;
function hiddenIfNot(grantTypes2, ...other) {
  return (_ctx, { values }) => {
    const hasGrantType = grantTypes2.find((t) => t === String(values.grantType ?? defaultGrantType));
    const hasOtherBools = other.every((t) => t(values));
    const show = hasGrantType && hasOtherBools;
    return { hidden: !show };
  };
}
var authorizationUrls = [
  "https://github.com/login/oauth/authorize",
  "https://account.box.com/api/oauth2/authorize",
  "https://accounts.google.com/o/oauth2/v2/auth",
  "https://api.imgur.com/oauth2/authorize",
  "https://bitly.com/oauth/authorize",
  "https://gitlab.example.com/oauth/authorize",
  "https://medium.com/m/oauth/authorize",
  "https://public-api.wordpress.com/oauth2/authorize",
  "https://slack.com/oauth/authorize",
  "https://todoist.com/oauth/authorize",
  "https://www.dropbox.com/oauth2/authorize",
  "https://www.linkedin.com/oauth/v2/authorization",
  "https://MY_SHOP.myshopify.com/admin/oauth/access_token"
];
var accessTokenUrls = [
  "https://github.com/login/oauth/access_token",
  "https://api-ssl.bitly.com/oauth/access_token",
  "https://api.box.com/oauth2/token",
  "https://api.dropboxapi.com/oauth2/token",
  "https://api.imgur.com/oauth2/token",
  "https://api.medium.com/v1/tokens",
  "https://gitlab.example.com/oauth/token",
  "https://public-api.wordpress.com/oauth2/token",
  "https://slack.com/api/oauth.access",
  "https://todoist.com/oauth/access_token",
  "https://www.googleapis.com/oauth2/v4/token",
  "https://www.linkedin.com/oauth/v2/accessToken",
  "https://MY_SHOP.myshopify.com/admin/oauth/authorize"
];
var plugin = {
  authentication: {
    name: "oauth2",
    label: "OAuth 2.0",
    shortLabel: "OAuth 2",
    args: [
      {
        type: "select",
        name: "grantType",
        label: "Grant Type",
        hideLabel: true,
        defaultValue: defaultGrantType,
        options: grantTypes
      },
      // Always-present fields
      { type: "text", name: "clientId", label: "Client ID" },
      {
        type: "text",
        name: "clientSecret",
        label: "Client Secret",
        password: true,
        dynamic: hiddenIfNot(["authorization_code", "resource_owner", "client_credential"])
      },
      {
        type: "text",
        name: "authorizationUrl",
        label: "Authorization URL",
        dynamic: hiddenIfNot(["authorization_code", "implicit"]),
        placeholder: authorizationUrls[0],
        completionOptions: authorizationUrls.map((url) => ({ label: url, value: url }))
      },
      {
        type: "text",
        name: "accessTokenUrl",
        label: "Access Token URL",
        placeholder: accessTokenUrls[0],
        dynamic: hiddenIfNot(["authorization_code", "resource_owner", "client_credential"]),
        completionOptions: accessTokenUrls.map((url) => ({ label: url, value: url }))
      },
      {
        type: "text",
        name: "redirectUri",
        label: "Redirect URI",
        optional: true,
        dynamic: hiddenIfNot(["authorization_code", "implicit"])
      },
      {
        type: "checkbox",
        name: "usePkce",
        label: "Use PKCE",
        dynamic: hiddenIfNot(["authorization_code"])
      },
      {
        type: "select",
        name: "pkceChallengeMethod",
        label: "Code Challenge Method",
        options: [{ name: "SHA-256", value: PKCE_SHA256 }, { name: "Plain", value: PKCE_PLAIN }],
        defaultValue: DEFAULT_PKCE_METHOD,
        dynamic: hiddenIfNot(["authorization_code"], ({ usePkce }) => !!usePkce)
      },
      {
        type: "text",
        name: "pkceCodeVerifier",
        label: "Code Verifier",
        placeholder: "Automatically generated if not provided",
        optional: true,
        dynamic: hiddenIfNot(["authorization_code"], ({ usePkce }) => !!usePkce)
      },
      {
        type: "text",
        name: "username",
        label: "Username",
        optional: true,
        dynamic: hiddenIfNot(["resource_owner"])
      },
      {
        type: "text",
        name: "password",
        label: "Password",
        password: true,
        optional: true,
        dynamic: hiddenIfNot(["resource_owner"])
      },
      {
        type: "select",
        name: "responseType",
        label: "Response Type",
        defaultValue: "token",
        options: [
          { name: "Access Token", value: "token" },
          { name: "ID Token", value: "id_token" },
          { name: "ID and Access Token", value: "id_token token" }
        ],
        dynamic: hiddenIfNot(["implicit"])
      },
      {
        type: "accordion",
        label: "Advanced",
        inputs: [
          { type: "text", name: "scope", label: "Scope", optional: true },
          { type: "text", name: "state", label: "State", optional: true },
          { type: "text", name: "headerPrefix", label: "Header Prefix", optional: true, defaultValue: "Bearer" }
        ]
      },
      {
        type: "banner",
        content: { type: "markdown", content: "Hello" },
        async dynamic(ctx, args) {
          const token = await getToken(ctx, args.requestId);
          if (token == null) {
            return { hidden: true };
          }
          return {
            content: {
              type: "markdown",
              content: token ? "token: `" + token.response.access_token + "`" : "No token"
            }
          };
        }
      }
    ],
    async onApply(ctx, { values, requestId }) {
      const headerPrefix = optionalString(values, "headerPrefix") ?? "";
      const grantType = requiredString(values, "grantType");
      let token;
      console.log("Performing OAuth", values);
      if (grantType === "authorization_code") {
        const authorizationUrl = requiredString(values, "authorizationUrl");
        const accessTokenUrl = requiredString(values, "accessTokenUrl");
        token = await getAuthorizationCode(ctx, requestId, {
          accessTokenUrl: accessTokenUrl.match(/^https?:\/\//) ? accessTokenUrl : `https://${accessTokenUrl}`,
          authorizationUrl: authorizationUrl.match(/^https?:\/\//) ? authorizationUrl : `https://${authorizationUrl}`,
          clientId: requiredString(values, "clientId"),
          clientSecret: requiredString(values, "clientSecret"),
          redirectUri: optionalString(values, "redirectUri"),
          scope: optionalString(values, "scope"),
          state: optionalString(values, "state"),
          pkce: values.usePkce ? {
            challengeMethod: requiredString(values, "pkceChallengeMethod"),
            codeVerifier: optionalString(values, "pkceCodeVerifier")
          } : null
        });
      } else if (grantType === "implicit") {
        const authorizationUrl = requiredString(values, "authorizationUrl");
        token = await getImplicit(ctx, requestId, {
          responseType: requiredString(values, "responseType"),
          authorizationUrl: authorizationUrl.match(/^https?:\/\//) ? authorizationUrl : `https://${authorizationUrl}`,
          clientId: requiredString(values, "clientId"),
          redirectUri: optionalString(values, "redirectUri"),
          scope: optionalString(values, "scope"),
          state: optionalString(values, "state")
        });
      }
      const headerValue = `${headerPrefix} ${token}`.trim();
      return {
        setHeaders: [{
          name: "Authorization",
          value: headerValue
        }]
      };
    }
  }
};
function optionalString(values, name) {
  const arg = values[name];
  if (arg == null || arg == "") return null;
  return `${arg}`;
}
function requiredString(values, name) {
  const arg = optionalString(values, name);
  if (!arg) throw new Error(`Missing required argument ${name}`);
  return arg;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
