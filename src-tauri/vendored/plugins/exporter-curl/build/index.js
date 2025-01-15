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
  plugin: () => plugin,
  pluginHookExport: () => pluginHookExport
});
module.exports = __toCommonJS(src_exports);
var NEWLINE = "\\\n ";
var plugin = {
  httpRequestActions: [{
    key: "export-curl",
    label: "Copy as Curl",
    icon: "copy",
    async onSelect(ctx, args) {
      const rendered_request = await ctx.httpRequest.render({ httpRequest: args.httpRequest, purpose: "preview" });
      const data = await pluginHookExport(ctx, rendered_request);
      ctx.clipboard.copyText(data);
      ctx.toast.show({ message: "Curl copied to clipboard", icon: "copy" });
    }
  }]
};
async function pluginHookExport(_ctx, request) {
  const xs = ["curl"];
  if (request.method) xs.push("-X", request.method);
  if (request.url) xs.push(quote(request.url));
  xs.push(NEWLINE);
  for (const p of (request.urlParameters ?? []).filter(onlyEnabled)) {
    xs.push("--url-query", quote(`${p.name}=${p.value}`));
    xs.push(NEWLINE);
  }
  for (const h of (request.headers ?? []).filter(onlyEnabled)) {
    xs.push("--header", quote(`${h.name}: ${h.value}`));
    xs.push(NEWLINE);
  }
  if (Array.isArray(request.body?.form)) {
    const flag = request.bodyType === "multipart/form-data" ? "--form" : "--data";
    for (const p of (request.body?.form ?? []).filter(onlyEnabled)) {
      if (p.file) {
        let v = `${p.name}=@${p.file}`;
        v += p.contentType ? `;type=${p.contentType}` : "";
        xs.push(flag, v);
      } else {
        xs.push(flag, quote(`${p.name}=${p.value}`));
      }
      xs.push(NEWLINE);
    }
  } else if (typeof request.body?.query === "string") {
    const body = { query: request.body.query || "", variables: maybeParseJSON(request.body.variables, void 0) };
    xs.push("--data-raw", `${quote(JSON.stringify(body))}`);
    xs.push(NEWLINE);
  } else if (typeof request.body?.text === "string") {
    xs.push("--data-raw", `${quote(request.body.text)}`);
    xs.push(NEWLINE);
  }
  if (request.authenticationType === "basic" || request.authenticationType === "digest") {
    if (request.authenticationType === "digest") xs.push("--digest");
    xs.push(
      "--user",
      quote(`${request.authentication?.username ?? ""}:${request.authentication?.password ?? ""}`)
    );
    xs.push(NEWLINE);
  }
  if (request.authenticationType === "bearer") {
    xs.push("--header", quote(`Authorization: Bearer ${request.authentication?.token ?? ""}`));
    xs.push(NEWLINE);
  }
  if (xs[xs.length - 1] === NEWLINE) {
    xs.splice(xs.length - 1, 1);
  }
  return xs.join(" ");
}
function quote(arg) {
  const escaped = arg.replace(/'/g, "\\'");
  return `'${escaped}'`;
}
function onlyEnabled(v) {
  return v.enabled !== false && !!v.name;
}
function maybeParseJSON(v, fallback) {
  try {
    return JSON.parse(v);
  } catch (err) {
    return fallback;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin,
  pluginHookExport
});
