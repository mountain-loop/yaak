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
  { name: "Authorization Code", value: "authorization_code" /* AuthorizationCode */ },
  { name: "Implicit", value: "implicit" /* Implicit */ },
  { name: "Resource Owner Password Credential", value: "resource_owner_password_credential" /* ResourceOwnerPasswordCredential */ },
  { name: "Client Credentials", value: "client_credentials" /* ClientCredentials */ }
];
var defaultGrantType = grantTypes[0].value;
var plugin = {
  authentication: {
    name: "oauth2",
    label: "OAuth 2",
    shortLabel: "OAuth 2.0",
    config: (_ctx, { config }) => [
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
        name: "authorizationUrl",
        label: "Authorization URL",
        optional: true
        // visible: {
        //   type: 'value_in',
        //   name: 'grantType',
        //   values: [GrantType.AuthorizationCode, GrantType.Implicit],
        // },
      },
      {
        type: "text",
        name: "accessTokenUrl",
        label: "Access Token URL",
        optional: true
        // visible: {
        //   type: 'value_in',
        //   name: 'grantType',
        //   values: [GrantType.AuthorizationCode, GrantType.ResourceOwnerPasswordCredential, GrantType.ClientCredentials],
        // },
      },
      {
        type: "text",
        name: "clientSecret",
        label: "Client Secret",
        optional: true
        // visible: {
        //   type: 'value_in',
        //   name: 'grantType',
        //   values: [GrantType.AuthorizationCode, GrantType.ResourceOwnerPasswordCredential, GrantType.ClientCredentials],
        // },
      },
      {
        type: "text",
        name: "username",
        label: "Username",
        optional: true
        // visible: {
        //   type: 'value_in',
        //   name: 'grantType',
        //   values: [GrantType.ResourceOwnerPasswordCredential],
        // },
      },
      {
        type: "text",
        name: "password",
        label: "Password",
        password: true,
        optional: true
        // visible: {
        //   type: 'value_in',
        //   name: 'grantType',
        //   values: [GrantType.ResourceOwnerPasswordCredential],
        // },
      },
      {
        type: "text",
        name: "redirectUri",
        label: "Redirect URI",
        optional: true
        // visible: {
        //   type: 'value_in',
        //   name: 'grantType',
        //   values: [GrantType.AuthorizationCode, GrantType.Implicit],
        // },
      },
      {
        type: "text",
        name: "scope",
        label: "Scope",
        optional: true
        // visible: {
        //   type: 'value_in',
        //   name: 'grantType',
        //   values: [],
        // },
      },
      {
        type: "text",
        name: "state",
        label: "State",
        optional: true
      }
    ],
    async onApply(ctx, args) {
      const token = await getAuthorizationCode(ctx, {
        accessTokenUrl: String(args.config.accessTokenUrl),
        authorizationUrl: String(args.config.authorizationUrl),
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
