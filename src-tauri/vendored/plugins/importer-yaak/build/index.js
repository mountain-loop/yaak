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
  migrateImport: () => migrateImport,
  plugin: () => plugin
});
module.exports = __toCommonJS(src_exports);
var plugin = {
  importer: {
    name: "Yaak",
    description: "Yaak official format",
    onImport(_ctx, args) {
      return migrateImport(args.text);
    }
  }
};
function migrateImport(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    return void 0;
  }
  if (!isJSObject(parsed)) {
    return void 0;
  }
  const isYaakExport = "yaakSchema" in parsed;
  if (!isYaakExport) {
    return;
  }
  if ("requests" in parsed.resources) {
    parsed.resources.httpRequests = parsed.resources.requests;
    delete parsed.resources["requests"];
  }
  for (const workspace of parsed.resources.workspaces ?? []) {
    if ("variables" in workspace) {
      const baseEnvironment = {
        id: `GENERATE_ID::base_env_${workspace["id"]}`,
        name: "Global Variables",
        variables: workspace.variables,
        workspaceId: workspace.id
      };
      parsed.resources.environments = parsed.resources.environments ?? [];
      parsed.resources.environments.push(baseEnvironment);
      delete workspace.variables;
      for (const environment of parsed.resources.environments) {
        if (environment.workspaceId === workspace.id && environment.id !== baseEnvironment.id) {
          environment.environmentId = baseEnvironment.id;
        }
      }
    }
  }
  for (const environment of parsed.resources.environments ?? []) {
    if ("environmentId" in environment) {
      environment.base = environment.environmentId == null;
      delete environment.environmentId;
    }
  }
  return { resources: parsed.resources };
}
function isJSObject(obj) {
  return Object.prototype.toString.call(obj) === "[object Object]";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  migrateImport,
  plugin
});
