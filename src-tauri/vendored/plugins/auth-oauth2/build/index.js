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

// src/getAccessToken.ts
var import_node_fs = require("node:fs");
async function getAccessToken(ctx, {
  accessTokenUrl,
  scope,
  params,
  grantType,
  credentialsInBody,
  clientId,
  clientSecret
}) {
  console.log("Getting access token", accessTokenUrl);
  const httpRequest = {
    method: "POST",
    url: accessTokenUrl,
    bodyType: "application/x-www-form-urlencoded",
    body: {
      form: [
        { name: "grant_type", value: grantType },
        ...params
      ]
    },
    headers: [
      { name: "User-Agent", value: "yaak" },
      { name: "Accept", value: "application/x-www-form-urlencoded, application/json" },
      { name: "Content-Type", value: "application/x-www-form-urlencoded" }
    ]
  };
  if (scope) httpRequest.body.form.push({ name: "scope", value: scope });
  if (credentialsInBody) {
    httpRequest.body.form.push({ name: "client_id", value: clientId });
    httpRequest.body.form.push({ name: "client_secret", value: clientSecret });
  } else {
    const value = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    httpRequest.headers.push({ name: "Authorization", value });
  }
  const resp = await ctx.httpRequest.send({ httpRequest });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error("Failed to fetch access token with status=" + resp.status);
  }
  const body = (0, import_node_fs.readFileSync)(resp.bodyPath ?? "", "utf8");
  let response;
  try {
    response = JSON.parse(body);
  } catch {
    response = Object.fromEntries(new URLSearchParams(body));
  }
  if (response.error) {
    throw new Error("Failed to fetch access token with " + response.error);
  }
  return response;
}

// src/getOrRefreshAccessToken.ts
var import_node_fs2 = require("node:fs");

// src/store.ts
async function storeToken(ctx, contextId, response) {
  if (!response.access_token) {
    throw new Error(`Token not found in response`);
  }
  const expiresAt = response.expires_in ? Date.now() + response.expires_in * 1e3 : null;
  const token = {
    response,
    expiresAt
  };
  await ctx.store.set(tokenStoreKey(contextId), token);
  return token;
}
async function getToken(ctx, contextId) {
  return ctx.store.get(tokenStoreKey(contextId));
}
async function deleteToken(ctx, contextId) {
  return ctx.store.delete(tokenStoreKey(contextId));
}
function tokenStoreKey(context_id) {
  return ["token", context_id].join("::");
}

// src/getOrRefreshAccessToken.ts
async function getOrRefreshAccessToken(ctx, contextId, {
  scope,
  accessTokenUrl,
  credentialsInBody,
  clientId,
  clientSecret,
  forceRefresh
}) {
  const token = await getToken(ctx, contextId);
  if (token == null) {
    return null;
  }
  const now = Date.now() / 1e3;
  const isExpired = token.expiresAt && now > token.expiresAt;
  if (!isExpired && !forceRefresh) {
    return token;
  }
  if (!token.response.refresh_token) {
    return null;
  }
  const httpRequest = {
    method: "POST",
    url: accessTokenUrl,
    bodyType: "application/x-www-form-urlencoded",
    body: {
      form: [
        { name: "grant_type", value: "refresh_token" },
        { name: "refresh_token", value: token.response.refresh_token }
      ]
    },
    headers: [
      { name: "User-Agent", value: "yaak" },
      { name: "Accept", value: "application/x-www-form-urlencoded, application/json" },
      { name: "Content-Type", value: "application/x-www-form-urlencoded" }
    ]
  };
  if (scope) httpRequest.body.form.push({ name: "scope", value: scope });
  if (credentialsInBody) {
    httpRequest.body.form.push({ name: "client_id", value: clientId });
    httpRequest.body.form.push({ name: "client_secret", value: clientSecret });
  } else {
    const value = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    httpRequest.headers.push({ name: "Authorization", value });
  }
  const resp = await ctx.httpRequest.send({ httpRequest });
  if (resp.status === 401) {
    console.log("Unauthorized refresh_token request");
    await deleteToken(ctx, contextId);
    return null;
  }
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error("Failed to fetch access token with status=" + resp.status);
  }
  const body = (0, import_node_fs2.readFileSync)(resp.bodyPath ?? "", "utf8");
  let response;
  try {
    response = JSON.parse(body);
  } catch {
    response = Object.fromEntries(new URLSearchParams(body));
  }
  if (response.error) {
    throw new Error(`Failed to fetch access token with ${response.error} -> ${response.error_description}`);
  }
  const newResponse = {
    ...response,
    // Assign a new one or keep the old one,
    refresh_token: response.refresh_token ?? token.response.refresh_token
  };
  return storeToken(ctx, contextId, newResponse);
}

// src/grants/authorizationCode.ts
var PKCE_SHA256 = "S256";
var PKCE_PLAIN = "plain";
var DEFAULT_PKCE_METHOD = PKCE_SHA256;
async function getAuthorizationCode(ctx, contextId, {
  authorizationUrl: authorizationUrlRaw,
  accessTokenUrl,
  clientId,
  clientSecret,
  redirectUri,
  scope,
  state,
  credentialsInBody,
  pkce
}) {
  const token = await getOrRefreshAccessToken(ctx, contextId, {
    accessTokenUrl,
    scope,
    clientId,
    clientSecret,
    credentialsInBody
  });
  if (token != null) {
    return token;
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
  return new Promise(async (resolve, reject) => {
    const authorizationUrlStr = authorizationUrl.toString();
    console.log("Authorizing", authorizationUrlStr);
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
        const response = await getAccessToken(ctx, {
          grantType: "authorization_code",
          accessTokenUrl,
          clientId,
          clientSecret,
          scope,
          credentialsInBody,
          params: [
            { name: "code", value: code },
            ...redirectUri ? [{ name: "redirect_uri", value: redirectUri }] : []
          ]
        });
        try {
          resolve(await storeToken(ctx, contextId, response));
        } catch (err) {
          reject(err);
        }
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

// src/grants/clientCredentials.ts
async function getClientCredentials(ctx, contextId, {
  accessTokenUrl,
  clientId,
  clientSecret,
  scope,
  credentialsInBody
}) {
  const token = await getToken(ctx, contextId);
  if (token) {
  }
  const response = await getAccessToken(ctx, {
    grantType: "client_credentials",
    accessTokenUrl,
    clientId,
    clientSecret,
    scope,
    credentialsInBody,
    params: []
  });
  return storeToken(ctx, contextId, response);
}

// src/grants/implicit.ts
function getImplicit(ctx, contextId, {
  authorizationUrl: authorizationUrlRaw,
  responseType,
  clientId,
  redirectUri,
  scope,
  state
}) {
  return new Promise(async (resolve, reject) => {
    const token = await getToken(ctx, contextId);
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
        try {
          resolve(await storeToken(ctx, contextId, response));
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}

// src/grants/password.ts
async function getPassword(ctx, contextId, {
  accessTokenUrl,
  clientId,
  clientSecret,
  username,
  password,
  credentialsInBody,
  scope
}) {
  const token = await getOrRefreshAccessToken(ctx, contextId, {
    accessTokenUrl,
    scope,
    clientId,
    clientSecret,
    credentialsInBody
  });
  if (token != null) {
    return token;
  }
  const response = await getAccessToken(ctx, {
    accessTokenUrl,
    clientId,
    clientSecret,
    scope,
    grantType: "password",
    credentialsInBody,
    params: [
      { name: "username", value: username },
      { name: "password", value: password }
    ]
  });
  return storeToken(ctx, contextId, response);
}

// src/index.ts
var grantTypes = [
  { label: "Authorization Code", value: "authorization_code" },
  { label: "Implicit", value: "implicit" },
  { label: "Resource Owner Password Credential", value: "password" },
  { label: "Client Credentials", value: "client_credentials" }
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
    actions: [
      {
        label: "Copy Current Token",
        icon: "copy",
        async onSelect(ctx, { contextId }) {
          const token = await getToken(ctx, contextId);
          if (token == null) {
            await ctx.toast.show({ message: "No token to copy", color: "warning" });
          } else {
            await ctx.clipboard.copyText(token.response.access_token);
            await ctx.toast.show({ message: "Token copied to clipboard", icon: "copy", color: "success" });
          }
        }
      },
      {
        label: "Delete Token",
        icon: "trash",
        async onSelect(ctx, { contextId }) {
          if (await deleteToken(ctx, contextId)) {
            await ctx.toast.show({ message: "Token deleted", color: "success" });
          } else {
            await ctx.toast.show({ message: "No token to delete", color: "warning" });
          }
        }
      }
    ],
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
        dynamic: hiddenIfNot(["authorization_code", "password", "client_credentials"])
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
        dynamic: hiddenIfNot(["authorization_code", "password", "client_credentials"]),
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
        type: "text",
        name: "state",
        label: "State",
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
        options: [{ label: "SHA-256", value: PKCE_SHA256 }, { label: "Plain", value: PKCE_PLAIN }],
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
        dynamic: hiddenIfNot(["password"])
      },
      {
        type: "text",
        name: "password",
        label: "Password",
        password: true,
        optional: true,
        dynamic: hiddenIfNot(["password"])
      },
      {
        type: "select",
        name: "responseType",
        label: "Response Type",
        defaultValue: "token",
        options: [
          { label: "Access Token", value: "token" },
          { label: "ID Token", value: "id_token" },
          { label: "ID and Access Token", value: "id_token token" }
        ],
        dynamic: hiddenIfNot(["implicit"])
      },
      {
        type: "accordion",
        label: "Advanced",
        inputs: [
          { type: "text", name: "scope", label: "Scope", optional: true },
          { type: "text", name: "headerPrefix", label: "Header Prefix", optional: true, defaultValue: "Bearer" },
          {
            type: "select",
            name: "credentials",
            label: "Send Credentials",
            defaultValue: "body",
            options: [
              { label: "In Request Body", value: "body" },
              { label: "As Basic Authentication", value: "basic" }
            ]
          }
        ]
      },
      {
        type: "accordion",
        label: "Access Token Response",
        async dynamic(ctx, { contextId }) {
          const token = await getToken(ctx, contextId);
          if (token == null) {
            return { hidden: true };
          }
          return {
            label: "Access Token Response",
            inputs: [
              {
                type: "editor",
                defaultValue: JSON.stringify(token.response, null, 2),
                hideLabel: true,
                readOnly: true,
                language: "json"
              }
            ]
          };
        }
      }
    ],
    async onApply(ctx, { values, contextId }) {
      const headerPrefix = optionalString(values, "headerPrefix") ?? "";
      const grantType = requiredString(values, "grantType");
      const credentialsInBody = values.credentials === "body";
      let token;
      if (grantType === "authorization_code") {
        const authorizationUrl = requiredString(values, "authorizationUrl");
        const accessTokenUrl = requiredString(values, "accessTokenUrl");
        token = await getAuthorizationCode(ctx, contextId, {
          accessTokenUrl: accessTokenUrl.match(/^https?:\/\//) ? accessTokenUrl : `https://${accessTokenUrl}`,
          authorizationUrl: authorizationUrl.match(/^https?:\/\//) ? authorizationUrl : `https://${authorizationUrl}`,
          clientId: requiredString(values, "clientId"),
          clientSecret: requiredString(values, "clientSecret"),
          redirectUri: optionalString(values, "redirectUri"),
          scope: optionalString(values, "scope"),
          state: optionalString(values, "state"),
          credentialsInBody,
          pkce: values.usePkce ? {
            challengeMethod: requiredString(values, "pkceChallengeMethod"),
            codeVerifier: optionalString(values, "pkceCodeVerifier")
          } : null
        });
      } else if (grantType === "implicit") {
        const authorizationUrl = requiredString(values, "authorizationUrl");
        token = await getImplicit(ctx, contextId, {
          authorizationUrl: authorizationUrl.match(/^https?:\/\//) ? authorizationUrl : `https://${authorizationUrl}`,
          clientId: requiredString(values, "clientId"),
          redirectUri: optionalString(values, "redirectUri"),
          responseType: requiredString(values, "responseType"),
          scope: optionalString(values, "scope"),
          state: optionalString(values, "state")
        });
      } else if (grantType === "client_credentials") {
        const accessTokenUrl = requiredString(values, "accessTokenUrl");
        token = await getClientCredentials(ctx, contextId, {
          accessTokenUrl: accessTokenUrl.match(/^https?:\/\//) ? accessTokenUrl : `https://${accessTokenUrl}`,
          clientId: requiredString(values, "clientId"),
          clientSecret: requiredString(values, "clientSecret"),
          scope: optionalString(values, "scope"),
          credentialsInBody
        });
      } else if (grantType === "password") {
        const accessTokenUrl = requiredString(values, "accessTokenUrl");
        token = await getPassword(ctx, contextId, {
          accessTokenUrl: accessTokenUrl.match(/^https?:\/\//) ? accessTokenUrl : `https://${accessTokenUrl}`,
          clientId: requiredString(values, "clientId"),
          clientSecret: requiredString(values, "clientSecret"),
          username: requiredString(values, "username"),
          password: requiredString(values, "password"),
          scope: optionalString(values, "scope"),
          credentialsInBody
        });
      } else {
        throw new Error("Invalid grant type " + grantType);
      }
      const headerValue = `${headerPrefix} ${token.response.access_token}`.trim();
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
