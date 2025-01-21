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
var grantTypes = [{
  name: "Authorization Code",
  value: "authorization_code"
}];
var defaultGrantType = grantTypes[0].value;
var plugin = {
  authentication: {
    name: "oauth2",
    label: "OAuth 2",
    shortLabel: "OAuth 2.0",
    config: [{
      type: "select",
      name: "grantType",
      label: "Grant Type",
      defaultValue: defaultGrantType,
      options: grantTypes
    }, {
      type: "text",
      name: "authorizationUrl",
      label: "Authorization URL",
      optional: true
    }, {
      type: "text",
      name: "accessTokenUrl",
      label: "Access Token URL",
      optional: true
    }, {
      type: "text",
      name: "clientId",
      label: "Client ID",
      optional: true
    }, {
      type: "text",
      name: "clientSecret",
      label: "Client Secret",
      optional: true
    }, {
      type: "text",
      name: "redirectUri",
      label: "Redirect URI",
      optional: true
    }, {
      type: "text",
      name: "scope",
      label: "Scope",
      optional: true
    }],
    async onApply(ctx, args) {
      console.log("PERFORMING OAUTH 2.0", args.config);
      return new Promise(async (resolve, reject) => {
        try {
          const authorizationUrl = new URL(`${args.config.authorizationUrl ?? ""}`);
          authorizationUrl.searchParams.set("client_id", `${args.config.clientId ?? ""}`);
          authorizationUrl.searchParams.set("redirect_uri", `${args.config.redirectUri ?? ""}`);
          authorizationUrl.searchParams.set("scope", `${args.config.scope ?? ""}`);
          await ctx.window.openUrl({
            url: authorizationUrl.toString(),
            async onNavigate({ url: urlStr }) {
              const url = new URL(urlStr);
              const code = url.searchParams.get("code");
              if (!code) return;
              resolve({ setHeaders: [{ name: "Authorization", value: `Bearer ${code}` }] });
              const req = {
                method: "POST",
                bodyType: "application/x-www-form-urlencoded",
                body: {
                  form: [
                    { name: "client_id", value: args.config.clientId || "" },
                    { name: "client_secret", value: args.config.clientSecret || "" },
                    { name: "code", value: code || "" },
                    { name: "redirect_uri", value: args.config.redirectUri || "" }
                  ]
                },
                url: `${args.config.accessTokenUrl}`,
                headers: [
                  { name: "Accept", value: "application/json" },
                  { name: "Content-Type", value: "application/x-www-form-urlencoded" }
                ],
                workspaceId: "wk_woHS9oiCdW"
              };
              console.log("SENDING AUTH TOKEN REQUSET", JSON.stringify(req, null, 1));
              const resp = await ctx.httpRequest.send({
                // @ts-ignore
                httpRequest: req
              });
              const body = (0, import_node_fs.readFileSync)(resp.bodyPath ?? "", "utf8");
              console.log("RECEIVED RESPONSE", resp.status, body);
            }
          });
        } catch (err) {
          console.log("ERR");
          reject(err);
        }
      });
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
