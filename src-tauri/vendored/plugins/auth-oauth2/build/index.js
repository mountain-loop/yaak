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
var import_node_fs = require("node:fs");
var grantTypes = [
  { name: "Authorization Code", value: "authorization_code" },
  { name: "Implicit", value: "implicit" },
  { name: "Resource Owner Password Credential", value: "resource_owner" },
  { name: "Client Credentials", value: "client_credential" }
];
var defaultGrantType = grantTypes[0].value;
function onlyTypes(config, ...grantTypes2) {
  return !grantTypes2.find((t) => t === String(config.grantType ?? defaultGrantType));
}
var authorizationUrls = [
  "https://MY_SHOP.myshopify.com/admin/oauth/access_token",
  "https://account.box.com/api/oauth2/authorize",
  "https://accounts.google.com/o/oauth2/v2/auth",
  "https://api.imgur.com/oauth2/authorize",
  "https://bitly.com/oauth/authorize",
  "https://github.com/login/oauth/authorize",
  "https://gitlab.example.com/oauth/authorize",
  "https://medium.com/m/oauth/authorize",
  "https://public-api.wordpress.com/oauth2/authorize",
  "https://slack.com/oauth/authorize",
  "https://todoist.com/oauth/authorize",
  "https://www.dropbox.com/oauth2/authorize",
  "https://www.linkedin.com/oauth/v2/authorization"
];
var accessTokenUrls = [
  "https://MY_SHOP.myshopify.com/admin/oauth/authorize",
  "https://api-ssl.bitly.com/oauth/access_token",
  "https://api.box.com/oauth2/token",
  "https://api.dropboxapi.com/oauth2/token",
  "https://api.imgur.com/oauth2/token",
  "https://api.medium.com/v1/tokens",
  "https://github.com/login/oauth/access_token",
  "https://gitlab.example.com/oauth/token",
  "https://public-api.wordpress.com/oauth2/token",
  "https://slack.com/api/oauth.access",
  "https://todoist.com/oauth/access_token",
  "https://www.googleapis.com/oauth2/v4/token",
  "https://www.linkedin.com/oauth/v2/accessToken"
];
var plugin = {
  authentication: {
    name: "oauth2",
    label: "OAuth 2",
    shortLabel: "OAuth 2.0",
    config: (_ctx, { config }) => {
      return [
        {
          type: "select",
          name: "grantType",
          label: "Grant Type",
          hideLabel: true,
          defaultValue: defaultGrantType,
          options: grantTypes
        },
        // Always-present fields
        { type: "text", name: "clientId", label: "Client ID", optional: true },
        {
          type: "text",
          name: "clientSecret",
          label: "Client Secret",
          optional: true,
          hidden: onlyTypes(config, "authorization_code", "resource_owner", "client_credential")
        },
        {
          type: "text",
          name: "authorizationUrl",
          label: "Authorization URL",
          optional: true,
          hidden: onlyTypes(config, "authorization_code", "implicit"),
          completionOptions: authorizationUrls.map((url) => ({ label: url, value: url }))
        },
        {
          type: "text",
          name: "accessTokenUrl",
          label: "Access Token URL",
          optional: true,
          hidden: onlyTypes(config, "authorization_code", "resource_owner", "client_credential"),
          completionOptions: accessTokenUrls.map((url) => ({ label: url, value: url }))
        },
        {
          type: "text",
          name: "username",
          label: "Username",
          optional: true,
          hidden: onlyTypes(config, "resource_owner")
        },
        {
          type: "text",
          name: "password",
          label: "Password",
          password: true,
          optional: true,
          hidden: onlyTypes(config, "resource_owner")
        },
        {
          type: "text",
          name: "redirectUri",
          label: "Redirect URI",
          optional: true,
          hidden: onlyTypes(config, "authorization_code", "implicit")
        },
        {
          type: "text",
          name: "scope",
          label: "Scope",
          optional: true
        },
        {
          type: "text",
          name: "state",
          label: "State",
          optional: true
        }
      ];
    },
    async onApply(ctx, args) {
      const accessTokenUrl = String(args.config.accessTokenUrl);
      const authorizationUrl = String(args.config.authorizationUrl);
      const token = await getAuthorizationCode(ctx, {
        accessTokenUrl: accessTokenUrl.match(/^https?:\/\//) ? accessTokenUrl : `https://${accessTokenUrl}`,
        authorizationUrl: authorizationUrl.match(/^https?:\/\//) ? authorizationUrl : `https://${authorizationUrl}`,
        clientId: String(args.config.clientId),
        clientSecret: String(args.config.clientSecret),
        redirectUri: String(args.config.redirectUri),
        scope: String(args.config.scope),
        state: String(args.config.state)
      });
      return { setHeaders: [{ name: "Authorization", value: `Bearer ${token}` }] };
    }
  }
};
function getAuthorizationCode(ctx, {
  accessTokenUrl,
  clientId,
  clientSecret,
  redirectUri,
  scope,
  state,
  ...config
}) {
  const authorizationUrl = new URL(`${config.authorizationUrl ?? ""}`);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  if (scope) authorizationUrl.searchParams.set("scope", scope);
  if (state) authorizationUrl.searchParams.set("state", state);
  const authorizationUrlStr = authorizationUrl.toString();
  console.log("Opening authorization url", authorizationUrlStr);
  return new Promise(async (resolve, reject) => {
    let { close } = await ctx.window.openUrl({
      url: authorizationUrlStr,
      label: "oauth-authorization-url",
      async onNavigate({ url: urlStr }) {
        const url = new URL(urlStr);
        const code = url.searchParams.get("code");
        if (!code) {
          return;
        }
        close();
        const resp = await ctx.httpRequest.send({
          httpRequest: {
            method: "POST",
            url: accessTokenUrl,
            urlParameters: [
              { name: "client_id", value: clientId },
              { name: "client_secret", value: clientSecret },
              { name: "code", value: code },
              { name: "redirect_uri", value: redirectUri }
            ],
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
        const bodyObj = JSON.parse(body);
        const accessToken = bodyObj["access_token"];
        resolve(accessToken);
      }
    });
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
